import {
  buildBigQuerySchemaPageQuery,
  readBigQueryDataSourceLocation,
  readBigQuerySchemaPage,
} from '../bigQuerySchema.js';

function resultWithRows(rows: Array<Record<string, unknown>>) {
  return { query_result: { data: { rows } } };
}

describe('BigQuery schema pagination', () => {
  it('builds a bounded, region-scoped metadata query', () => {
    const query = buildBigQuerySchemaPageQuery('asia-northeast1', 2, 25);

    expect(query).toContain('`region-asia-northeast1`.INFORMATION_SCHEMA.TABLES');
    expect(query).toContain('`region-asia-northeast1`.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS');
    expect(query).toContain('LIMIT 26 OFFSET 25');
    expect(query).toContain('WHERE page_position <= 25');
    expect(query).toContain('JOIN page_tables AS t\n    USING (table_catalog, table_schema, table_name)');
    expect(query).toContain('(SELECT COUNT(*) > 25 FROM numbered_tables) AS has_more');
    expect(query).toContain('TO_JSON_STRING(ARRAY_AGG(');
  });

  it('encodes search text instead of interpolating it into SQL', () => {
    const search = "Customer's 売上";
    const query = buildBigQuerySchemaPageQuery('US', 1, 10, search);

    expect(query).toContain('`region-us`.INFORMATION_SCHEMA.TABLES');
    expect(query).toContain(Buffer.from(search, 'utf8').toString('hex'));
    expect(query).not.toContain(search);
  });

  it('rejects unsafe locations and offsets', () => {
    expect(() => buildBigQuerySchemaPageQuery('us`; DROP TABLE x', 1, 25)).toThrow(
      'BigQuery location contained unexpected characters',
    );
    expect(() => buildBigQuerySchemaPageQuery('us', Number.MAX_SAFE_INTEGER, 100)).toThrow(
      'page and pageSize produce an unsupported offset',
    );
  });

  it.each([
    [0, 25, 'page must be a positive integer'],
    [1, 0, 'pageSize must be an integer between 1 and 100'],
    [1, 1.5, 'pageSize must be an integer between 1 and 100'],
    [1, 101, 'pageSize must be an integer between 1 and 100'],
  ])('rejects invalid query pagination page=%p pageSize=%p', (page, pageSize, message) => {
    expect(() => buildBigQuerySchemaPageQuery('us', page, pageSize)).toThrow(message);
  });

  it('reads and normalizes the configured BigQuery location', () => {
    expect(readBigQueryDataSourceLocation({
      id: 7,
      options: { location: 'ASIA-NORTHEAST1' },
    })).toBe('asia-northeast1');
    expect(readBigQueryDataSourceLocation({ options: { location: 'us' } })).toBe('us');
  });

  it('returns null for a missing or unsafe configured location', () => {
    expect(readBigQueryDataSourceLocation({ options: {} })).toBeNull();
    expect(readBigQueryDataSourceLocation({ options: { location: 'us`' } })).toBeNull();
    expect(readBigQueryDataSourceLocation(null)).toBeNull();
  });

  it('groups metadata rows into Redash schema tables', () => {
    const result = readBigQuerySchemaPage(resultWithRows([
      {
        page_position: 1,
        table_name: 'analytics.events',
        table_description: 'GA4 export',
        columns_json: JSON.stringify([
          { name: 'event_date', type: 'STRING', description: null },
          { name: 'event_params.key', type: 'STRING', description: 'Parameter key' },
        ]),
        has_more: true,
      },
      {
        page_position: 2,
        table_name: 'sales.orders',
        table_description: null,
        columns_json: '[]',
        has_more: true,
      },
    ]), 3, 2);

    expect(result).toEqual({
      page: 3,
      pageSize: 2,
      hasMore: true,
      nextPage: 4,
      schema: [
        {
          name: 'analytics.events',
          description: 'GA4 export',
          columns: [
            { name: 'event_date', type: 'STRING' },
            { name: 'event_params.key', type: 'STRING', description: 'Parameter key' },
          ],
        },
        { name: 'sales.orders', columns: [] },
      ],
    });
  });

  it('returns an empty terminal page when the offset is beyond the schema', () => {
    expect(readBigQuerySchemaPage(resultWithRows([]), 99, 25)).toEqual({
      page: 99,
      pageSize: 25,
      hasMore: false,
      nextPage: null,
      schema: [],
    });
  });

  it('rejects malformed metadata rows instead of silently dropping tables', () => {
    expect(() => readBigQuerySchemaPage(resultWithRows([
      null as unknown as Record<string, unknown>,
    ]), 1, 25)).toThrow(
      'BigQuery metadata query response contained an invalid result row',
    );
    expect(() => readBigQuerySchemaPage(resultWithRows([{ has_more: false }]), 1, 25)).toThrow(
      'BigQuery metadata query returned a row without a table name',
    );
    expect(() => readBigQuerySchemaPage(resultWithRows([{
      table_name: 'analytics.events',
      columns_json: 'not json',
      has_more: false,
    }]), 1, 25)).toThrow(
      'BigQuery metadata query returned invalid columns for table analytics.events',
    );
  });
});
