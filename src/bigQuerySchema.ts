import type { RedashSchemaPage, SchemaTable } from './schemaStream.js';
import { schemaPageOffset } from './schemaPagination.js';

type QueryRows = Array<Record<string, unknown>>;

function queryRows(response: unknown): QueryRows {
  if (typeof response !== 'object' || response === null) {
    throw new Error('BigQuery metadata query returned an invalid response');
  }

  const outer = response as Record<string, unknown>;
  const queryResult = typeof outer.query_result === 'object' && outer.query_result !== null
    ? outer.query_result as Record<string, unknown>
    : outer;
  const data = queryResult.data;
  if (typeof data !== 'object' || data === null) {
    throw new Error('BigQuery metadata query response did not contain result data');
  }

  const rows = (data as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) {
    throw new Error('BigQuery metadata query response did not contain result rows');
  }
  if (!rows.every(row => typeof row === 'object' && row !== null)) {
    throw new Error('BigQuery metadata query response contained an invalid result row');
  }

  return rows as QueryRows;
}

export function readBigQueryDataSourceLocation(dataSource: unknown): string | null {
  if (typeof dataSource !== 'object' || dataSource === null) {
    return null;
  }

  const options = (dataSource as Record<string, unknown>).options;
  if (typeof options !== 'object' || options === null) {
    return null;
  }

  const location = (options as Record<string, unknown>).location;
  if (typeof location !== 'string' || !/^[a-z0-9-]+$/i.test(location)) {
    return null;
  }

  return location.toLowerCase();
}

export function buildBigQuerySchemaPageQuery(
  location: string,
  page: number,
  pageSize: number,
  search?: string,
): string {
  if (!/^[a-z0-9-]+$/i.test(location)) {
    throw new Error('BigQuery location contained unexpected characters');
  }

  const offset = schemaPageOffset(page, pageSize);

  const region = `region-${location.toLowerCase()}`;
  const searchPredicate = search === undefined
    ? ''
    : `\n    AND STRPOS(\n      LOWER(CONCAT(table_schema, '.', table_name)),\n      LOWER(CAST(FROM_HEX('${Buffer.from(search, 'utf8').toString('hex')}') AS STRING))\n    ) > 0`;

  return `
WITH candidate_tables AS (
  SELECT table_catalog, table_schema, table_name
  FROM \`${region}\`.INFORMATION_SCHEMA.TABLES
  WHERE table_schema != 'INFORMATION_SCHEMA'${searchPredicate}
  ORDER BY table_schema, table_name
  LIMIT ${pageSize + 1} OFFSET ${offset}
),
numbered_tables AS (
  SELECT
    *,
    ROW_NUMBER() OVER (ORDER BY table_schema, table_name) AS page_position
  FROM candidate_tables
),
page_tables AS (
  SELECT *
  FROM numbered_tables
  WHERE page_position <= ${pageSize}
),
table_descriptions AS (
  SELECT
    d.table_catalog,
    d.table_schema,
    d.table_name,
    ANY_VALUE(JSON_VALUE(d.option_value)) AS table_description
  FROM \`${region}\`.INFORMATION_SCHEMA.TABLE_OPTIONS AS d
  JOIN page_tables AS t
    USING (table_catalog, table_schema, table_name)
  WHERE d.option_name = 'description'
  GROUP BY d.table_catalog, d.table_schema, d.table_name
)
SELECT
  t.page_position,
  CONCAT(t.table_schema, '.', t.table_name) AS table_name,
  d.table_description,
  IFNULL(
    TO_JSON_STRING(ARRAY_AGG(
      IF(c.field_path IS NULL, NULL, STRUCT(
        c.field_path AS name,
        c.data_type AS type,
        c.description AS description
      ))
      IGNORE NULLS
      ORDER BY c.field_path
    )),
    '[]'
  ) AS columns_json,
  (SELECT COUNT(*) > ${pageSize} FROM numbered_tables) AS has_more
FROM page_tables AS t
LEFT JOIN \`${region}\`.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS AS c
  USING (table_catalog, table_schema, table_name)
LEFT JOIN table_descriptions AS d
  USING (table_catalog, table_schema, table_name)
GROUP BY t.page_position, t.table_schema, t.table_name, d.table_description
ORDER BY t.page_position
  `.trim();
}

export function readBigQuerySchemaPage(
  response: unknown,
  page: number,
  pageSize: number,
): RedashSchemaPage {
  const rows = queryRows(response);
  const tables: SchemaTable[] = [];
  const byName = new Map<string, SchemaTable>();

  for (const row of rows) {
    const tableName = row.table_name;
    if (typeof tableName !== 'string') {
      throw new Error('BigQuery metadata query returned a row without a table name');
    }

    let table = byName.get(tableName);
    if (table === undefined) {
      table = { name: tableName, columns: [] };
      if (typeof row.table_description === 'string') {
        table.description = row.table_description;
      }
      byName.set(tableName, table);
      tables.push(table);
    }

    if (typeof row.columns_json !== 'string') {
      throw new Error(`BigQuery metadata query returned invalid columns for table ${tableName}`);
    }

    let columns: unknown;
    try {
      columns = JSON.parse(row.columns_json);
    } catch {
      throw new Error(`BigQuery metadata query returned invalid columns for table ${tableName}`);
    }
    if (!Array.isArray(columns)) {
      throw new Error(`BigQuery metadata query returned invalid columns for table ${tableName}`);
    }

    for (const column of columns) {
      if (
        typeof column !== 'object'
        || column === null
        || typeof (column as Record<string, unknown>).name !== 'string'
        || typeof (column as Record<string, unknown>).type !== 'string'
      ) {
        throw new Error(`BigQuery metadata query returned invalid columns for table ${tableName}`);
      }
      const record = column as Record<string, unknown>;
      table.columns.push({
        name: record.name as string,
        type: record.type as string,
        ...(typeof record.description === 'string'
          ? { description: record.description }
          : {}),
      });
    }
  }

  const hasMore = rows.some(row => row.has_more === true);
  return {
    page,
    pageSize,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    schema: tables,
  };
}
