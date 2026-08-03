import type { Readable } from 'node:stream';
import chain from 'stream-chain';
import Assembler from 'stream-json/assembler.js';
import { parser } from 'stream-json';
import type { Token } from 'stream-json/parser.js';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import { schemaPageOffset } from './schemaPagination.js';
import { destroyQuietly } from './utils.js';

export interface SchemaTable {
  name: string;
  description?: string | null;
  columns: Array<{
    name: string;
    type: string;
    description?: string | null;
  }>;
}

export interface RedashSchemaPage {
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextPage: number | null;
  schema: SchemaTable[];
}

export interface RedashSchemaJobResponse {
  job: Record<string, unknown>;
}

export type RedashSchemaResponse = RedashSchemaPage | RedashSchemaJobResponse;

export interface ReadSchemaPageOptions {
  page: number;
  pageSize: number;
  search?: string;
  deadlineMs: number;
}

// Reads one page of tables from a Redash schema response body without ever
// materializing the whole document: the body is parsed incrementally and the
// stream is destroyed as soon as the requested page is complete, which also
// aborts the underlying HTTP transfer.
export async function readSchemaPage(
  source: Readable,
  options: ReadSchemaPageOptions,
): Promise<RedashSchemaResponse> {
  const { page, pageSize, search, deadlineMs } = options;
  const searchLower = search?.toLowerCase();
  let offset: number;
  try {
    offset = schemaPageOffset(page, pageSize);
  } catch (error) {
    destroyQuietly(source);
    throw error;
  }

  // A cache miss makes Redash return {"job": {...}} while it refreshes the
  // schema asynchronously. Preserve that small response just as the previous
  // unpaginated client did. If the job happened to finish before Redash
  // serialized it, its result can contain the complete schema; select and page
  // that array instead of assembling it into the job object.
  let documentDepth = 0;
  let awaitingJobValue = false;
  let jobAssembler: Assembler<Record<string, unknown>> | undefined;
  let skippedJobResultDepth = 0;
  let jobResponse: RedashSchemaJobResponse | undefined;

  function observeResponseToken(token: Token): Token {
    if (jobAssembler !== undefined) {
      if (skippedJobResultDepth > 0) {
        if (token.name === 'startObject' || token.name === 'startArray') {
          skippedJobResultDepth += 1;
        } else if (token.name === 'endObject' || token.name === 'endArray') {
          skippedJobResultDepth -= 1;
        }
      } else if (
        token.name === 'startArray'
        && jobAssembler.depth === 1
        && (jobAssembler.key === 'result' || jobAssembler.key === 'query_result_id')
      ) {
        // Redash serializes the completed schema under both result and the
        // legacy query_result_id field. Keep metadata assembly bounded and let
        // the page selector below consume job.result.
        jobAssembler.consume({ name: 'nullValue', value: null });
        skippedJobResultDepth = 1;
      } else {
        jobAssembler.consume(token);
        if (jobAssembler.done) {
          const job = jobAssembler.current;
          if (typeof job !== 'object' || job === null || Array.isArray(job)) {
            throw new Error('Redash schema response contained an invalid "job" object');
          }
          jobResponse = { job };
          jobAssembler = undefined;
        }
      }
    } else if (awaitingJobValue) {
      awaitingJobValue = false;
      if (token.name !== 'startObject') {
        throw new Error('Redash schema response contained an invalid "job" object');
      }
      jobAssembler = new Assembler<Record<string, unknown>>();
      jobAssembler.consume(token);
    } else if (documentDepth === 1 && token.name === 'keyValue' && token.value === 'job') {
      awaitingJobValue = true;
    }

    if (token.name === 'startObject' || token.name === 'startArray') {
      documentDepth += 1;
    } else if (token.name === 'endObject' || token.name === 'endArray') {
      documentDepth -= 1;
    }

    return token;
  }

  // Distinguishes a valid empty schema array from an unrelated error payload.
  // job.result is selected too because a very fast refresh can finish before
  // the initial schema response is serialized.
  let sawSchemaArray = false;

  const pipeline = chain([
    source,
    // streamArray's assembler only reads packed values (keyValue/stringValue),
    // so the chunk-wise value tokens would be generated only to be discarded.
    parser({ streamValues: false }),
    observeResponseToken,
    pick({
      filter: (stack, token) => token.name === 'startArray' && (
        (stack.length === 1 && stack[0] === 'schema')
        || (stack.length === 2 && stack[0] === 'job' && stack[1] === 'result')
      ),
    }),
    (token: Token) => {
      sawSchemaArray = true;
      return token;
    },
    streamArray(),
  ]);

  // The axios timeout only covers time-to-first-response for streamed bodies,
  // so consumption needs its own deadline.
  const deadline = setTimeout(() => {
    pipeline.destroy(new Error(
      `Timed out reading schema response after ${deadlineMs}ms; raise REDASH_TIMEOUT for very large schemas`,
    ));
  }, deadlineMs);

  const collected: SchemaTable[] = [];
  let matched = 0;
  let hasMore = false;
  try {
    for await (const entry of pipeline as AsyncIterable<{ key: number; value: unknown }>) {
      const value = entry.value as SchemaTable;
      if (searchLower !== undefined) {
        const name = typeof value?.name === 'string' ? value.name : '';
        if (!name.toLowerCase().includes(searchLower)) {
          continue;
        }
      }
      matched += 1;
      if (matched <= offset) {
        continue;
      }
      if (collected.length === pageSize) {
        hasMore = true;
        break;
      }
      collected.push(value);
    }
  } finally {
    clearTimeout(deadline);
    destroyQuietly(pipeline);
    // stream-chain does not reliably propagate destroy back to its input, and
    // destroying the source is what actually aborts the HTTP transfer.
    destroyQuietly(source);
  }

  if (!sawSchemaArray) {
    if (jobResponse !== undefined) {
      return jobResponse;
    }
    throw new Error('Redash schema response did not contain a "schema" array');
  }

  return {
    page,
    pageSize,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    schema: collected,
  };
}
