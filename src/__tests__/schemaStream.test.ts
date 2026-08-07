import { Readable } from 'node:stream';
import {
  readSchemaPage,
  type RedashSchemaPage,
  type RedashSchemaResponse,
  type SchemaTable,
} from '../schemaStream.js';

function expectSchemaPage(response: RedashSchemaResponse): asserts response is RedashSchemaPage {
  if (!('schema' in response)) {
    throw new Error('Expected a schema page, received a schema job');
  }
}

function makeTables(count: number, namePrefix = 'table_'): SchemaTable[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${namePrefix}${String(i).padStart(4, '0')}`,
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'value', type: 'string' },
    ],
  }));
}

function* bufferChunks(buffer: Buffer, size: number): Generator<Buffer> {
  for (let i = 0; i < buffer.length; i += size) {
    yield buffer.subarray(i, i + size);
  }
}

// Deliberately small chunks so parsing is proven to work across chunk
// boundaries, including boundaries inside multi-byte UTF-8 sequences.
function sourceFrom(json: string, chunkSize = 7): Readable {
  return Readable.from(bufferChunks(Buffer.from(json), chunkSize));
}

function schemaJson(tables: SchemaTable[]): string {
  return JSON.stringify({ schema: tables });
}

const baseOptions = { page: 1, pageSize: 25, deadlineMs: 5000 };

describe('readSchemaPage', () => {
  it('returns everything when the schema fits in one page', async () => {
    const tables = makeTables(3);
    const result = await readSchemaPage(sourceFrom(schemaJson(tables)), baseOptions);

    expect(result).toEqual({
      page: 1,
      pageSize: 25,
      hasMore: false,
      nextPage: null,
      schema: tables,
    });
  });

  it('parses table names with multi-byte characters split across chunks', async () => {
    const tables: SchemaTable[] = [
      { name: '売上データ.注文履歴', columns: [{ name: '注文番号', type: 'string' }] },
    ];
    const result = await readSchemaPage(sourceFrom(schemaJson(tables), 3), baseOptions);
    expectSchemaPage(result);

    expect(result.schema).toEqual(tables);
  });

  it('reports hasMore/nextPage at the page boundary', async () => {
    const tables = makeTables(26);
    const json = schemaJson(tables);

    const page1 = await readSchemaPage(sourceFrom(json), baseOptions);
    expectSchemaPage(page1);
    expect(page1.schema).toEqual(tables.slice(0, 25));
    expect(page1.hasMore).toBe(true);
    expect(page1.nextPage).toBe(2);

    const page2 = await readSchemaPage(sourceFrom(json), { ...baseOptions, page: 2 });
    expectSchemaPage(page2);
    expect(page2.schema).toEqual(tables.slice(25));
    expect(page2.hasMore).toBe(false);
    expect(page2.nextPage).toBeNull();
  });

  it('does not report hasMore when the last page is exactly full', async () => {
    const tables = makeTables(50);
    const result = await readSchemaPage(sourceFrom(schemaJson(tables)), { ...baseOptions, page: 2 });
    expectSchemaPage(result);

    expect(result.schema).toEqual(tables.slice(25));
    expect(result.hasMore).toBe(false);
    expect(result.nextPage).toBeNull();
  });

  it('returns an empty page beyond the end of the schema', async () => {
    const result = await readSchemaPage(sourceFrom(schemaJson(makeTables(10))), { ...baseOptions, page: 3 });
    expectSchemaPage(result);

    expect(result.schema).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextPage).toBeNull();
  });

  it('filters by search case-insensitively and paginates the filtered set', async () => {
    const tables = [...makeTables(170, 'events_'), ...makeTables(30, 'Users_')];
    const json = schemaJson(tables);

    const page1 = await readSchemaPage(sourceFrom(json, 64), { ...baseOptions, search: 'users' });
    expectSchemaPage(page1);
    expect(page1.schema).toEqual(tables.slice(170, 195));
    expect(page1.hasMore).toBe(true);
    expect(page1.nextPage).toBe(2);

    const page2 = await readSchemaPage(sourceFrom(json, 64), { ...baseOptions, page: 2, search: 'users' });
    expectSchemaPage(page2);
    expect(page2.schema).toEqual(tables.slice(195));
    expect(page2.hasMore).toBe(false);
  });

  it('destroys the source early once the page is complete', async () => {
    const buffer = Buffer.from(schemaJson(makeTables(2000)));
    const chunkSize = 512;
    const totalChunks = Math.ceil(buffer.length / chunkSize);
    let yielded = 0;
    async function* countingChunks() {
      for (const chunk of bufferChunks(buffer, chunkSize)) {
        yielded += 1;
        yield chunk;
      }
    }
    const source = Readable.from(countingChunks());

    const result = await readSchemaPage(source, baseOptions);
    expectSchemaPage(result);

    expect(result.schema).toHaveLength(25);
    expect(result.hasMore).toBe(true);
    expect(source.destroyed).toBe(true);
    expect(yielded).toBeLessThan(totalChunks / 2);
  });

  it('rejects on malformed JSON', async () => {
    await expect(readSchemaPage(sourceFrom('{"schema": [{'), baseOptions)).rejects.toThrow();
  });

  it('rejects when the response lacks a schema array', async () => {
    await expect(
      readSchemaPage(sourceFrom('{"message": "Internal Server Error"}'), baseOptions),
    ).rejects.toThrow('Redash schema response did not contain a "schema" array');
  });

  it('resolves an empty schema as an empty page', async () => {
    const result = await readSchemaPage(sourceFrom('{"schema": []}'), baseOptions);

    expect(result).toEqual({
      page: 1,
      pageSize: 25,
      hasMore: false,
      nextPage: null,
      schema: [],
    });
  });

  it('returns a pending Redash schema job without treating it as malformed', async () => {
    const response = {
      job: {
        id: 'schema-job-123',
        updated_at: 0,
        status: 1,
        error: '',
        result: null,
        query_result_id: null,
      },
    };

    const result = await readSchemaPage(sourceFrom(JSON.stringify(response), 3), baseOptions);

    expect(result).toEqual(response);
  });

  it('paginates a schema job that completed before its initial response was serialized', async () => {
    const tables = makeTables(3);
    const response = {
      job: {
        id: 'schema-job-123',
        updated_at: 1,
        status: 3,
        error: '',
        result: tables,
        // Redash duplicates job.result into this legacy field.
        query_result_id: tables,
      },
    };

    const result = await readSchemaPage(sourceFrom(JSON.stringify(response), 5), {
      ...baseOptions,
      page: 2,
      pageSize: 2,
    });

    expect(result).toEqual({
      page: 2,
      pageSize: 2,
      hasMore: false,
      nextPage: null,
      schema: tables.slice(2),
    });
  });

  it('rejects when schema is not an array', async () => {
    await expect(
      readSchemaPage(sourceFrom('{"schema": {"not": "an array"}}'), baseOptions),
    ).rejects.toThrow();
  });

  it('rejects invalid pagination and destroys the source before parsing', async () => {
    const source = sourceFrom('{"schema": []}');

    await expect(
      readSchemaPage(source, { ...baseOptions, pageSize: 101 }),
    ).rejects.toThrow('pageSize must be an integer between 1 and 100');
    expect(source.destroyed).toBe(true);
  });

  it('rejects when the source stalls past the deadline', async () => {
    const source = new Readable({ read() {} });
    source.push('{"schema": [');

    await expect(
      readSchemaPage(source, { ...baseOptions, deadlineMs: 50 }),
    ).rejects.toThrow(/Timed out reading schema response after 50ms/);
    expect(source.destroyed).toBe(true);
  });
});
