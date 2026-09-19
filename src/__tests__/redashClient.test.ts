import { RedashClient } from '../redashClient.js';
import axios from 'axios';
import { jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { logger } from '../logger.js';
import { isToolContentCaptureEnabled } from '../telemetry.js';
import type { RedashSchemaPage, RedashSchemaResponse } from '../schemaStream.js';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock logger
jest.mock('../logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  },
}));
jest.mock('../telemetry.js', () => ({
  isToolContentCaptureEnabled: jest.fn(),
}));

const mockedContentCapture = jest.mocked(isToolContentCaptureEnabled);

function expectSchemaPage(response: RedashSchemaResponse): asserts response is RedashSchemaPage {
  if (!('schema' in response)) {
    throw new Error('Expected a schema page, received a schema job');
  }
}

describe('RedashClient', () => {
  let client: RedashClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset environment variables
    process.env.REDASH_URL = 'https://redash.example.com';
    process.env.REDASH_API_KEY = 'test-api-key';
    process.env.REDASH_TIMEOUT = '30000';
    delete process.env.REDASH_EXTRA_HEADERS;
    mockedContentCapture.mockReturnValue(false);

    // Setup axios mock
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
      defaults: {
        headers: {},
      },
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

    client = new RedashClient();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw error if REDASH_URL is not set', () => {
      delete process.env.REDASH_URL;
      expect(() => new RedashClient()).toThrow(
        'REDASH_URL and REDASH_API_KEY must be provided in .env file'
      );
    });

    it('should throw error if REDASH_API_KEY is not set', () => {
      delete process.env.REDASH_API_KEY;
      expect(() => new RedashClient()).toThrow(
        'REDASH_URL and REDASH_API_KEY must be provided in .env file'
      );
    });

    it('should create axios instance with correct config', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://redash.example.com',
        headers: {
          Authorization: 'Key test-api-key',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
    });

    it('should fall back to the default timeout for invalid REDASH_TIMEOUT values', () => {
      for (const value of ['abc', ' ', '0', '30s']) {
        process.env.REDASH_TIMEOUT = value;
        mockedAxios.create.mockClear();
        new RedashClient();

        expect(mockedAxios.create).toHaveBeenCalledWith(
          expect.objectContaining({ timeout: 30000 })
        );
      }
    });

    it('should use a valid custom REDASH_TIMEOUT value', () => {
      process.env.REDASH_TIMEOUT = '5000';
      mockedAxios.create.mockClear();
      new RedashClient();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 5000 })
      );
    });

    it('should parse JSON extra headers', () => {
      process.env.REDASH_EXTRA_HEADERS = '{"CF-Access-Client-Id":"test-id","CF-Access-Client-Secret":"test-secret"}';

      mockedAxios.create.mockClear();
      new RedashClient();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'CF-Access-Client-Id': 'test-id',
            'CF-Access-Client-Secret': 'test-secret',
          }),
        })
      );
    });

    it('should parse key=value extra headers', () => {
      process.env.REDASH_EXTRA_HEADERS = 'X-Custom-Header=value1;X-Another-Header=value2';

      mockedAxios.create.mockClear();
      new RedashClient();

      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'value1',
            'X-Another-Header': 'value2',
          }),
        })
      );
    });

    it('should prevent Authorization header override', () => {
      process.env.REDASH_EXTRA_HEADERS = '{"Authorization":"malicious-key"}';

      mockedAxios.create.mockClear();
      new RedashClient();

      const callArgs = mockedAxios.create.mock.calls[0]?.[0];
      expect(callArgs?.headers).toBeDefined();
      expect((callArgs?.headers as any)?.Authorization).toBe('Key test-api-key');
    });
  });

  describe('getQueries', () => {
    it('should fetch queries with pagination', async () => {
      const mockResponse = {
        data: {
          count: 100,
          page: 1,
          page_size: 25,
          results: [
            { id: 1, name: 'Query 1' },
            { id: 2, name: 'Query 2' },
          ],
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getQueries(1, 25);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries', {
        params: { page: 1, page_size: 25, q: undefined },
      });
      expect(result).toEqual({
        count: 100,
        page: 1,
        pageSize: 25,
        results: mockResponse.data.results,
      });
    });

    it('should fetch queries with search query', async () => {
      const mockResponse = {
        data: {
          count: 10,
          page: 1,
          page_size: 25,
          results: [{ id: 1, name: 'Test Query' }],
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      await client.getQueries(1, 25, 'test');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries', {
        params: { page: 1, page_size: 25, q: 'test' },
      });
    });

    it('should throw error on failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(client.getQueries()).rejects.toThrow(
        'Failed to fetch queries from Redash'
      );
    });
  });

  describe('getQuery', () => {
    it('should fetch a specific query', async () => {
      const mockQuery = {
        id: 1,
        name: 'Test Query',
        query: 'SELECT * FROM users',
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockQuery });

      const result = await client.getQuery(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries/1');
      expect(result).toEqual(mockQuery);
    });

    it('should throw error on failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Not found'));

      await expect(client.getQuery(999)).rejects.toThrow(
        'Failed to fetch query 999 from Redash'
      );
    });
  });

  describe('createQuery', () => {
    it('should create a new query', async () => {
      const queryData = {
        name: 'New Query',
        data_source_id: 1,
        query: 'SELECT 1',
        description: 'Test',
      };

      const mockResponse = {
        data: {
          id: 123,
          ...queryData,
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.createQuery(queryData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/queries',
        expect.objectContaining({
          name: 'New Query',
          data_source_id: 1,
          query: 'SELECT 1',
          description: 'Test',
        })
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('keeps successful query content out of logs even when content capture is enabled', async () => {
      mockedContentCapture.mockReturnValue(true);
      const queryData = {
        name: 'Revenue details',
        data_source_id: 1,
        query: 'SELECT secret_value FROM private_table',
        description: 'Internal revenue analysis',
        options: { parameters: [{ name: 'customer_id', value: 42 }] },
      };
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 123, ...queryData } });

      await client.createQuery(queryData);

      const creatingLog = jest.mocked(logger.info).mock.calls.find(
        ([message]) => message === 'Creating Redash query',
      );
      expect(creatingLog?.[1]).toMatchObject({
        'http.request.method': 'POST',
        'url.path': '/api/queries',
        'redash.data_source.id': 1,
        'redash.request.header.names': [],
      });
      const exportedFields = JSON.stringify(jest.mocked(logger.info).mock.calls.map(([, fields]) => fields));
      expect(exportedFields).not.toContain('SELECT secret_value');
      expect(exportedFields).not.toContain('Internal revenue analysis');
      expect(exportedFields).not.toContain('customer_id');
    });

    it('should handle API errors', async () => {
      const queryData = {
        name: 'New Query',
        data_source_id: 1,
        query: 'SELECT 1',
      };

      const axiosError = {
        response: {
          status: 400,
          data: { message: 'Invalid query' },
        },
        config: {},
      };

      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(client.createQuery(queryData)).rejects.toThrow(
        /Redash API error \(400\)/
      );

      const failureLog = jest.mocked(logger.error).mock.calls.find(
        ([message]) => message === 'Redash create-query request failed',
      );
      expect(failureLog?.[1]).toMatchObject({
        'http.request.method': 'POST',
        'url.path': '/api/queries',
        'http.response.status_code': 400,
      });
      expect(failureLog?.[1]).not.toHaveProperty('redash.request.body');
      expect(failureLog?.[1]).not.toHaveProperty('redash.response.body');
    });

    it('captures Redash request and response bodies only after content opt-in', async () => {
      mockedContentCapture.mockReturnValue(true);
      const queryData = {
        name: 'Private query',
        data_source_id: 7,
        query: 'SELECT secret_value FROM private_table',
        description: 'Restricted report',
        options: { parameters: [{ name: 'account_id', value: 42 }] },
      };
      const axiosError = {
        message: 'Request failed',
        request: {},
        response: {
          status: 400,
          data: { message: 'Invalid query', detail: 'SELECT secret_value failed' },
        },
        config: {
          headers: { Authorization: 'Key must-not-be-exported' },
        },
      };
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(client.createQuery(queryData)).rejects.toThrow(/Redash API error \(400\)/);

      const failureLog = jest.mocked(logger.error).mock.calls.find(
        ([message]) => message === 'Redash create-query request failed',
      );
      expect(failureLog?.[1]).toMatchObject({
        'http.response.status_code': 400,
        'redash.request.body': expect.objectContaining({
          query: 'SELECT secret_value FROM private_table',
          description: 'Restricted report',
          options: { parameters: [{ name: 'account_id', value: 42 }] },
        }),
        'redash.response.body': {
          message: 'Invalid query',
          detail: 'SELECT secret_value failed',
        },
      });
      expect(JSON.stringify(failureLog?.[1])).not.toContain('must-not-be-exported');
    });
  });

  describe('updateQuery', () => {
    it('should update a query', async () => {
      const updateData = {
        name: 'Updated Query',
        description: 'Updated description',
      };

      const mockResponse = {
        data: {
          id: 1,
          ...updateData,
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.updateQuery(1, updateData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/queries/1',
        updateData
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('should only include defined fields', async () => {
      const updateData = {
        name: 'Updated Query',
        description: undefined,
      };

      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await client.updateQuery(1, updateData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/queries/1', {
        name: 'Updated Query',
      });
    });
  });

  describe('archiveQuery', () => {
    it('should archive a query', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.archiveQuery(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/queries/1');
      expect(result).toEqual({ success: true });
    });

    it('should throw error on failure', async () => {
      mockAxiosInstance.delete.mockRejectedValue(new Error('Not found'));

      await expect(client.archiveQuery(999)).rejects.toThrow(
        'Failed to archive query 999'
      );
    });
  });

  describe('executeQuery', () => {
    it('should execute a query and return immediate results', async () => {
      const mockResult = {
        id: 1,
        query_id: 123,
        data: {
          columns: [{ name: 'id', type: 'integer' }],
          rows: [{ id: 1 }],
        },
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResult });

      const result = await client.executeQuery(123);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/queries/123/results',
        { parameters: undefined, max_age: undefined }
      );
      expect(result).toEqual(mockResult);
    });

    it('should execute a query with parameters', async () => {
      const params = { date: '2024-01-01' };
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await client.executeQuery(123, params);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/queries/123/results',
        { parameters: params, max_age: undefined }
      );
    });

    it('should execute a query with max age override', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await client.executeQuery(123, { category: 'example-value' }, 0);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/queries/123/results',
        { parameters: { category: 'example-value' }, max_age: 0 }
      );
    });

    it('should poll for async results', async () => {
      const jobId = 'job-123';
      const mockJobResponse = {
        data: {
          job: {
            id: jobId,
          },
        },
      };

      const mockPollResponse = {
        data: {
          job: {
            status: 3,
            result: {
              id: 1,
              data: { columns: [], rows: [] },
            },
          },
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockJobResponse);
      mockAxiosInstance.get.mockResolvedValue(mockPollResponse);

      const result = await client.executeQuery(123);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/jobs/${jobId}`);
      expect(result).toEqual(mockPollResponse.data.job.result);
    });

    it('should preserve Redash job failures without wrapping their message', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { job: { id: 'job-failed' } } });
      mockAxiosInstance.get.mockResolvedValue({
        data: { job: { status: 4, error: 'SELECT private_value failed' } },
      });

      await expect(client.executeQuery(123)).rejects.toThrow('Query execution failed');

      const failureLog = jest.mocked(logger.error).mock.calls.find(
        ([message]) => message === 'Redash query job failed',
      );
      expect(failureLog?.[1]).toMatchObject({ 'redash.job.id': 'job-failed' });
      expect(failureLog?.[1]).not.toHaveProperty('redash.job.error');
    });

    it('captures the Redash job error after content opt-in', async () => {
      mockedContentCapture.mockReturnValue(true);
      mockAxiosInstance.post.mockResolvedValue({ data: { job: { id: 'job-failed' } } });
      mockAxiosInstance.get.mockResolvedValue({
        data: { job: { status: 4, error: 'SELECT private_value failed' } },
      });

      await expect(client.executeQuery(123)).rejects.toThrow('Query execution failed');

      const failureLog = jest.mocked(logger.error).mock.calls.find(
        ([message]) => message === 'Redash query job failed',
      );
      expect(failureLog?.[1]).toMatchObject({
        'redash.job.id': 'job-failed',
        'redash.job.error': 'SELECT private_value failed',
      });
    });
  });

  describe('executeAdhocQuery', () => {
    it('should execute an adhoc query', async () => {
      const mockResult = {
        id: 1,
        data: {
          columns: [{ name: 'count', type: 'integer' }],
          rows: [{ count: 5 }],
        },
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResult });

      const result = await client.executeAdhocQuery('SELECT COUNT(*) as count FROM users', 1);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/query_results',
        expect.objectContaining({
          query: 'SELECT COUNT(*) as count FROM users',
          data_source_id: 1,
          max_age: 0,
          apply_auto_limit: true,
        })
      );
      expect(result).toEqual(mockResult);
    });

    it('should allow automatic limits to be disabled', async () => {
      const mockResult = {
        id: 1,
        data: {
          columns: [],
          rows: [],
        },
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResult });

      await client.executeAdhocQuery('SELECT TOP 10 * FROM users', 2, false);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/query_results',
        expect.objectContaining({
          query: 'SELECT TOP 10 * FROM users',
          data_source_id: 2,
          apply_auto_limit: false,
        })
      );
    });
  });

  describe('getDataSources', () => {
    it('should fetch data sources', async () => {
      const mockDataSources = [
        { id: 1, name: 'PostgreSQL' },
        { id: 2, name: 'MySQL' },
      ];

      mockAxiosInstance.get.mockResolvedValue({ data: mockDataSources });

      const result = await client.getDataSources();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/data_sources');
      expect(result).toEqual(mockDataSources);
    });
  });

  describe('getDashboards', () => {
    it('should fetch dashboards', async () => {
      const mockResponse = {
        data: {
          count: 10,
          page: 1,
          page_size: 25,
          results: [
            { id: 1, name: 'Dashboard 1' },
            { id: 2, name: 'Dashboard 2' },
          ],
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getDashboards(1, 25);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/dashboards', {
        params: { page: 1, page_size: 25 },
      });
      expect(result).toEqual({
        count: 10,
        page: 1,
        pageSize: 25,
        results: mockResponse.data.results,
      });
    });
  });

  describe('getDashboard', () => {
    it('should fetch a specific dashboard', async () => {
      const mockDashboard = {
        id: 1,
        name: 'Test Dashboard',
        widgets: [],
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockDashboard });

      const result = await client.getDashboard(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/dashboards/1');
      expect(result).toEqual(mockDashboard);
    });
  });

  describe('getDashboardBySlug', () => {
    it('should fetch a dashboard by slug with legacy parameter', async () => {
      const mockDashboard = {
        id: 1,
        name: 'Test Dashboard',
        slug: 'test-dashboard',
        widgets: [],
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockDashboard });

      const result = await client.getDashboardBySlug('test-dashboard');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/dashboards/test-dashboard', {
        params: { legacy: null }
      });
      expect(result).toEqual(mockDashboard);
    });

    it('should throw error on failure', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Not found'));

      await expect(client.getDashboardBySlug('non-existent-slug')).rejects.toThrow(
        "Failed to fetch dashboard by slug 'non-existent-slug' from Redash"
      );
    });
  });

  describe('getVisualization', () => {
    it('should fetch a specific visualization', async () => {
      const mockVisualization = {
        id: 1,
        type: 'CHART',
        name: 'Test Chart',
        options: {},
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockVisualization });

      const result = await client.getVisualization(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/visualizations/1');
      expect(result).toEqual(mockVisualization);
    });
  });

  describe('createVisualization', () => {
    it('should create a visualization', async () => {
      const vizData = {
        query_id: 1,
        type: 'CHART',
        name: 'New Chart',
        options: { chartType: 'bar' },
      };

      mockAxiosInstance.post.mockResolvedValue({ data: { id: 123, ...vizData } });

      const result = await client.createVisualization(vizData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/visualizations', vizData);
      expect(result.id).toBe(123);
    });
  });

  describe('updateVisualization', () => {
    it('should update a visualization', async () => {
      const updateData = {
        name: 'Updated Chart',
        options: { chartType: 'line' },
      };

      mockAxiosInstance.post.mockResolvedValue({ data: { id: 1, ...updateData } });

      const result = await client.updateVisualization(1, updateData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/visualizations/1', updateData);
      expect(result.name).toBe('Updated Chart');
    });
  });

  describe('deleteVisualization', () => {
    it('should delete a visualization', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      await client.deleteVisualization(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/visualizations/1');
    });
  });

  describe('getQueryResultsAsCsv', () => {
    it('should fetch CSV results without refresh', async () => {
      const mockCsv = 'id,name\n1,test\n2,test2';

      mockAxiosInstance.get.mockResolvedValue({ data: mockCsv });

      const result = await client.getQueryResultsAsCsv(1, false);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries/1/results.csv', {
        responseType: 'text',
      });
      expect(result).toBe(mockCsv);
    });

    it('should refresh before fetching CSV results', async () => {
      const mockCsv = 'id,name\n1,test';

      mockAxiosInstance.post.mockResolvedValue({ data: {} });
      mockAxiosInstance.get.mockResolvedValue({ data: mockCsv });

      await client.getQueryResultsAsCsv(1, true);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/queries/1/results', {
        parameters: undefined,
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries/1/results.csv', {
        responseType: 'text',
      });
    });
  });

  describe('getSchemaPage', () => {
    beforeEach(() => {
      // Most tests in this block exercise the streamed non-BigQuery path.
      // Seed the type cache so each one can keep its HTTP mock focused on the
      // schema request under test.
      (client as unknown as { dataSourceTypes: Map<number, string> })
        .dataSourceTypes.set(1, 'pg');
    });

    const mockSchema = {
      schema: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'integer' },
            { name: 'email', type: 'string' },
          ],
        },
        {
          name: 'orders',
          columns: [{ name: 'id', type: 'integer' }],
        },
      ],
    };

    function schemaStream() {
      return Readable.from([Buffer.from(JSON.stringify(mockSchema))]);
    }

    it('should stream a schema page', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: schemaStream() });

      const result = await client.getSchemaPage(1, 1, 25);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/data_sources/1/schema', {
        responseType: 'stream',
      });
      expect(result).toEqual({
        page: 1,
        pageSize: 25,
        hasMore: false,
        nextPage: null,
        schema: mockSchema.schema,
      });
    });

    it('should default to page 1 with pageSize 25', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: schemaStream() });

      const result = await client.getSchemaPage(1);
      expectSchemaPage(result);

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });

    it('should return a pending schema job unchanged', async () => {
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
      mockAxiosInstance.get.mockResolvedValue({
        data: Readable.from([Buffer.from(JSON.stringify(response))]),
      });

      await expect(client.getSchemaPage(1)).resolves.toEqual(response);
    });

    it('should stream the schema when listing data sources is forbidden', async () => {
      (client as unknown as { dataSourceTypes: Map<number, string> })
        .dataSourceTypes.clear();
      const forbidden = Object.assign(new Error('Request failed with status code 403'), {
        response: { status: 403 },
      });
      mockAxiosInstance.get
        .mockRejectedValueOnce(forbidden)
        .mockResolvedValueOnce({ data: schemaStream() });

      const result = await client.getSchemaPage(1, 1, 25);
      expectSchemaPage(result);

      expect(result.schema).toEqual(mockSchema.schema);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(1, '/api/data_sources');
      expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(2, '/api/data_sources/1/schema', {
        responseType: 'stream',
      });
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalledWith(
        'Could not determine the data-source type; falling back to the Redash schema endpoint',
        expect.objectContaining({
          'redash.data_source.id': 1,
          'redash.schema.page': 1,
          'redash.schema.page_size': 25,
        }),
        expect.any(Error),
      );
    });

    it('should explain that Query Results has no static schema without calling its schema endpoint', async () => {
      (client as unknown as { dataSourceTypes: Map<number, string> })
        .dataSourceTypes.clear();
      mockAxiosInstance.get.mockResolvedValue({
        data: [{ id: 13, name: 'Query Results', type: 'results' }],
      });

      await expect(client.getSchemaPage(13)).rejects.toThrow(
        'Data source 13 is a Query Results data source and does not expose a static schema; '
        + 'use execute_adhoc_query with query_<query_id> or cached_query_<query_id> instead'
      );
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/data_sources');
      expect(mockAxiosInstance.get).not.toHaveBeenCalledWith(
        '/api/data_sources/13/schema',
        expect.anything(),
      );
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should reject an invalid page without calling Redash', async () => {
      await expect(client.getSchemaPage(1, 0)).rejects.toThrow('page must be a positive integer');
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('should reject an invalid pageSize without calling Redash', async () => {
      await expect(client.getSchemaPage(1, 1, 101)).rejects.toThrow(
        'pageSize must be an integer between 1 and 100'
      );
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('should reject a page whose offset cannot be represented safely', async () => {
      await expect(client.getSchemaPage(1, Number.MAX_SAFE_INTEGER, 100)).rejects.toThrow(
        'page and pageSize produce an unsupported offset'
      );
      expect(mockAxiosInstance.get).not.toHaveBeenCalled();
    });

    it('should query INFORMATION_SCHEMA for BigQuery and cache discovery metadata', async () => {
      (client as unknown as { dataSourceTypes: Map<number, string> })
        .dataSourceTypes.clear();
      mockAxiosInstance.get
        .mockResolvedValueOnce({
          data: [{ id: 4, name: 'bigquery', type: 'bigquery' }],
        })
        .mockResolvedValueOnce({
          data: { id: 4, type: 'bigquery', options: { location: 'ASIA-NORTHEAST1' } },
        });
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            query_result: {
              data: {
                rows: [{
                  page_position: 1,
                  table_name: 'analytics.events',
                  table_description: null,
                  columns_json: JSON.stringify([{ name: 'event_date', type: 'STRING' }]),
                  has_more: true,
                }],
              },
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            query_result: {
              data: {
                rows: [{
                  page_position: 1,
                  table_name: 'sales.orders',
                  table_description: null,
                  columns_json: JSON.stringify([{ name: 'id', type: 'INT64' }]),
                  has_more: false,
                }],
              },
            },
          },
        });

      const page1 = await client.getSchemaPage(4, 1, 1, 'analytics');
      const page2 = await client.getSchemaPage(4, 2, 1, 'analytics');
      expectSchemaPage(page1);
      expectSchemaPage(page2);

      expect(page1.schema[0]?.name).toBe('analytics.events');
      expect(page1.hasMore).toBe(true);
      expect(page2.schema[0]?.name).toBe('sales.orders');
      expect(page2.hasMore).toBe(false);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/data_sources');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/data_sources/4');
      expect(mockAxiosInstance.get).not.toHaveBeenCalledWith(
        '/api/data_sources/4/schema',
        expect.anything(),
      );
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
        1,
        '/api/query_results',
        expect.objectContaining({
          query: expect.stringContaining('LIMIT 2 OFFSET 0'),
          data_source_id: 4,
          apply_auto_limit: false,
        }),
      );
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
        2,
        '/api/query_results',
        expect.objectContaining({
          query: expect.stringContaining('LIMIT 2 OFFSET 1'),
          data_source_id: 4,
          apply_auto_limit: false,
        }),
      );
    });

    it('should cache every data-source type returned by the first discovery request', async () => {
      (client as unknown as { dataSourceTypes: Map<number, string> })
        .dataSourceTypes.clear();
      mockAxiosInstance.get.mockImplementation((path: string) => {
        if (path === '/api/data_sources') {
          return Promise.resolve({
            data: [
              { id: 1, name: 'postgres', type: 'pg' },
              { id: 2, name: 'mysql', type: 'mysql' },
              { id: 'invalid', name: 'invalid', type: 'pg' },
              { id: 3, name: 'missing-type' },
            ],
          });
        }
        if (path === '/api/data_sources/1/schema' || path === '/api/data_sources/2/schema') {
          return Promise.resolve({ data: schemaStream() });
        }
        return Promise.reject(new Error(`Unexpected path: ${path}`));
      });

      await client.getSchemaPage(1);
      await client.getSchemaPage(2);

      const discoveryCalls = mockAxiosInstance.get.mock.calls
        .filter(([path]: [string]) => path === '/api/data_sources');
      expect(discoveryCalls).toHaveLength(1);
    });

    it('should stream the schema when the BigQuery location is unavailable and cache that choice', async () => {
      (client as unknown as { dataSourceTypes: Map<number, string> })
        .dataSourceTypes.set(4, 'bigquery');
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: { id: 4, type: 'bigquery', options: {} } })
        .mockResolvedValueOnce({ data: schemaStream() })
        .mockResolvedValueOnce({ data: schemaStream() });

      const first = await client.getSchemaPage(4, 1, 1);
      const second = await client.getSchemaPage(4, 2, 1);
      expectSchemaPage(first);
      expectSchemaPage(second);

      expect(first.schema).toEqual([mockSchema.schema[0]]);
      expect(second.schema).toEqual([mockSchema.schema[1]]);
      expect(mockAxiosInstance.get.mock.calls
        .filter(([path]: [string]) => path === '/api/data_sources/4')).toHaveLength(1);
      expect(mockAxiosInstance.get.mock.calls
        .filter(([path]: [string]) => path === '/api/data_sources/4/schema')).toHaveLength(2);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('should stream the schema when BigQuery data-source discovery fails', async () => {
      (client as unknown as { dataSourceTypes: Map<number, string> })
        .dataSourceTypes.set(4, 'bigquery');
      mockAxiosInstance.get
        .mockRejectedValueOnce(new Error('detail unavailable'))
        .mockResolvedValueOnce({ data: schemaStream() });

      const result = await client.getSchemaPage(4, 1, 25);
      expectSchemaPage(result);

      expect(result.schema).toEqual(mockSchema.schema);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(logger.warning).toHaveBeenCalledWith(
        'Could not read the configured BigQuery location; falling back to the Redash schema endpoint',
        expect.objectContaining({
          'redash.data_source.id': 4,
          'redash.schema.page': 1,
          'redash.schema.page_size': 25,
        }),
        expect.any(Error),
      );
    });

    it('should fall back and disable the optimization after a BigQuery metadata query fails', async () => {
      (client as unknown as { dataSourceTypes: Map<number, string> })
        .dataSourceTypes.set(4, 'bigquery');
      mockAxiosInstance.get
        .mockResolvedValueOnce({
          data: { id: 4, type: 'bigquery', options: { location: 'us' } },
        })
        .mockResolvedValueOnce({ data: schemaStream() })
        .mockResolvedValueOnce({ data: schemaStream() });
      mockAxiosInstance.post.mockRejectedValue(new Error('warehouse unavailable'));

      const first = await client.getSchemaPage(4, 1, 1, 'user');
      const second = await client.getSchemaPage(4, 1, 1, 'order');
      expectSchemaPage(first);
      expectSchemaPage(second);

      expect(first.schema).toEqual([mockSchema.schema[0]]);
      expect(second.schema).toEqual([mockSchema.schema[1]]);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
      expect(logger.warning).toHaveBeenCalledWith(
        'BigQuery schema pagination failed; falling back to the Redash schema endpoint',
        expect.objectContaining({
          'redash.data_source.id': 4,
          'redash.schema.search_present': true,
        }),
        expect.any(Error),
      );
    });

    it('should log only a search marker unless content capture is enabled', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: schemaStream() });

      await client.getSchemaPage(1, 1, 25, 'users');

      const [, fields] = (logger.debug as jest.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect(fields['redash.schema.search_present']).toBe(true);
      expect(fields['redash.schema.search']).toBeUndefined();
    });

    it('should log the search term when content capture is enabled', async () => {
      mockedContentCapture.mockReturnValue(true);
      mockAxiosInstance.get.mockResolvedValue({ data: schemaStream() });

      await client.getSchemaPage(1, 1, 25, 'users');

      const [, fields] = (logger.debug as jest.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect(fields['redash.schema.search']).toBe('users');
      expect(fields['redash.schema.search_present']).toBe(true);
    });

    it('should destroy stream error bodies and keep them out of log fields', async () => {
      mockedContentCapture.mockReturnValue(true);
      (mockedAxios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
      const errorBody = new Readable({ read() {} });
      mockAxiosInstance.get.mockRejectedValue({
        isAxiosError: true,
        message: 'Request failed with status code 500',
        response: { status: 500, data: errorBody },
      });

      await expect(client.getSchemaPage(1)).rejects.toThrow(
        'Failed to fetch schema page for data source 1: Redash API error (500)'
      );
      expect(errorBody.destroyed).toBe(true);
      const [, fields] = (logger.error as jest.Mock).mock.calls[0] as [string, Record<string, unknown>];
      expect(fields['redash.response.body']).toBeUndefined();
      expect(fields['http.response.status_code']).toBe(500);
    });

    it('should wrap non-axios errors', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('socket hang up'));

      await expect(client.getSchemaPage(1)).rejects.toThrow(
        'Failed to fetch schema page for data source 1: socket hang up'
      );
    });
  });

  // Dashboard API Tests
  describe('createDashboard', () => {
    it('should create a new dashboard', async () => {
      const dashboardData = { name: 'New Dashboard', tags: ['test'] };
      const mockResponse = { data: { id: 1, ...dashboardData } };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.createDashboard(dashboardData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/dashboards', dashboardData);
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('updateDashboard', () => {
    it('should update a dashboard', async () => {
      const updateData = { name: 'Updated Dashboard' };
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 1, ...updateData } });

      const result = await client.updateDashboard(1, updateData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/dashboards/1', updateData);
      expect(result.name).toBe('Updated Dashboard');
    });
  });

  describe('archiveDashboard', () => {
    it('should archive a dashboard', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.archiveDashboard(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/dashboards/1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('forkDashboard', () => {
    it('should fork a dashboard', async () => {
      const mockResponse = { data: { id: 2, name: 'Forked Dashboard' } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.forkDashboard(1);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/dashboards/1/fork');
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('shareDashboard', () => {
    it('should share a dashboard', async () => {
      const mockResponse = { data: { public_url: 'http://example.com/public/abc', api_key: 'key123' } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.shareDashboard(1);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/dashboards/1/share');
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('unshareDashboard', () => {
    it('should unshare a dashboard', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.unshareDashboard(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/dashboards/1/share');
      expect(result).toEqual({ success: true });
    });
  });

  describe('getMyDashboards', () => {
    it('should fetch my dashboards', async () => {
      const mockResponse = {
        data: { count: 5, page: 1, page_size: 25, results: [{ id: 1, name: 'My Dashboard' }] }
      };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getMyDashboards(1, 25);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/dashboards/my', { params: { page: 1, page_size: 25 } });
      expect(result.results).toHaveLength(1);
    });
  });

  describe('getFavoriteDashboards', () => {
    it('should fetch favorite dashboards', async () => {
      const mockResponse = {
        data: { count: 3, page: 1, page_size: 25, results: [{ id: 1, name: 'Favorite Dashboard' }] }
      };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getFavoriteDashboards(1, 25);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/dashboards/favorites', { params: { page: 1, page_size: 25 } });
      expect(result.results).toHaveLength(1);
    });
  });

  describe('addDashboardFavorite', () => {
    it('should add dashboard to favorites', async () => {
      mockAxiosInstance.post.mockResolvedValue({});

      const result = await client.addDashboardFavorite(1);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/dashboards/1/favorite');
      expect(result).toEqual({ success: true });
    });
  });

  describe('removeDashboardFavorite', () => {
    it('should remove dashboard from favorites', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.removeDashboardFavorite(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/dashboards/1/favorite');
      expect(result).toEqual({ success: true });
    });
  });

  describe('getDashboardTags', () => {
    it('should fetch dashboard tags', async () => {
      const mockResponse = { data: { tags: [{ name: 'sales', count: 5 }] } };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getDashboardTags();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/dashboards/tags');
      expect(result).toEqual(mockResponse.data);
    });
  });

  // Alert API Tests
  describe('getAlerts', () => {
    it('should fetch all alerts', async () => {
      const mockAlerts = [{ id: 1, name: 'Alert 1' }, { id: 2, name: 'Alert 2' }];
      mockAxiosInstance.get.mockResolvedValue({ data: mockAlerts });

      const result = await client.getAlerts();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/alerts');
      expect(result).toEqual(mockAlerts);
    });
  });

  describe('getAlert', () => {
    it('should fetch a specific alert', async () => {
      const mockAlert = { id: 1, name: 'Test Alert', query_id: 123 };
      mockAxiosInstance.get.mockResolvedValue({ data: mockAlert });

      const result = await client.getAlert(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/alerts/1');
      expect(result).toEqual(mockAlert);
    });
  });

  describe('createAlert', () => {
    it('should create a new alert', async () => {
      const alertData = {
        name: 'New Alert',
        query_id: 123,
        options: { column: 'count', op: 'greater than', value: 100 }
      };
      const mockResponse = { data: { id: 1, ...alertData } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.createAlert(alertData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/alerts', alertData);
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('updateAlert', () => {
    it('should update an alert', async () => {
      const updateData = { name: 'Updated Alert' };
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 1, ...updateData } });

      const result = await client.updateAlert(1, updateData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/alerts/1', updateData);
      expect(result.name).toBe('Updated Alert');
    });
  });

  describe('deleteAlert', () => {
    it('should delete an alert', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.deleteAlert(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/alerts/1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('muteAlert', () => {
    it('should mute an alert', async () => {
      mockAxiosInstance.post.mockResolvedValue({});

      const result = await client.muteAlert(1);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/alerts/1/mute');
      expect(result).toEqual({ success: true });
    });
  });

  describe('getAlertSubscriptions', () => {
    it('should fetch alert subscriptions', async () => {
      const mockSubscriptions = [{ id: 1, alert_id: 1, user: { id: 1, name: 'User' } }];
      mockAxiosInstance.get.mockResolvedValue({ data: mockSubscriptions });

      const result = await client.getAlertSubscriptions(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/alerts/1/subscriptions');
      expect(result).toEqual(mockSubscriptions);
    });
  });

  describe('addAlertSubscription', () => {
    it('should add an alert subscription', async () => {
      const mockSubscription = { id: 1, alert_id: 1 };
      mockAxiosInstance.post.mockResolvedValue({ data: mockSubscription });

      const result = await client.addAlertSubscription(1, { destination_id: 2 });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/alerts/1/subscriptions', { destination_id: 2 });
      expect(result).toEqual(mockSubscription);
    });
  });

  describe('removeAlertSubscription', () => {
    it('should remove an alert subscription', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.removeAlertSubscription(1, 2);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/alerts/1/subscriptions/2');
      expect(result).toEqual({ success: true });
    });
  });

  // Query additional API Tests
  describe('forkQuery', () => {
    it('should fork a query', async () => {
      const mockResponse = { data: { id: 2, name: 'Forked Query' } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.forkQuery(1);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/queries/1/fork');
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('getMyQueries', () => {
    it('should fetch my queries', async () => {
      const mockResponse = {
        data: { count: 10, page: 1, page_size: 25, results: [{ id: 1, name: 'My Query' }] }
      };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getMyQueries(1, 25);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries/my', { params: { page: 1, page_size: 25 } });
      expect(result.results).toHaveLength(1);
    });
  });

  describe('getRecentQueries', () => {
    it('should fetch recent queries', async () => {
      const mockResponse = {
        data: { count: 5, page: 1, page_size: 25, results: [{ id: 1, name: 'Recent Query' }] }
      };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getRecentQueries(1, 25);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries/recent', { params: { page: 1, page_size: 25 } });
      expect(result.results).toHaveLength(1);
    });
  });

  describe('getQueryTags', () => {
    it('should fetch query tags', async () => {
      const mockResponse = { data: { tags: [{ name: 'analytics', count: 10 }] } };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getQueryTags();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries/tags');
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('getFavoriteQueries', () => {
    it('should fetch favorite queries', async () => {
      const mockResponse = {
        data: { count: 3, page: 1, page_size: 25, results: [{ id: 1, name: 'Favorite Query' }] }
      };
      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await client.getFavoriteQueries(1, 25);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/queries/favorites', { params: { page: 1, page_size: 25 } });
      expect(result.results).toHaveLength(1);
    });
  });

  describe('addQueryFavorite', () => {
    it('should add query to favorites', async () => {
      mockAxiosInstance.post.mockResolvedValue({});

      const result = await client.addQueryFavorite(1);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/queries/1/favorite');
      expect(result).toEqual({ success: true });
    });
  });

  describe('removeQueryFavorite', () => {
    it('should remove query from favorites', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.removeQueryFavorite(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/queries/1/favorite');
      expect(result).toEqual({ success: true });
    });
  });

  // Widget API Tests
  describe('getWidgets', () => {
    it('should fetch all widgets', async () => {
      const mockWidgets = [{ id: 1, dashboard_id: 1, width: 3 }];
      mockAxiosInstance.get.mockResolvedValue({ data: mockWidgets });

      const result = await client.getWidgets();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/widgets');
      expect(result).toEqual(mockWidgets);
    });
  });

  describe('getWidget', () => {
    it('should fetch a specific widget', async () => {
      const mockWidget = { id: 1, dashboard_id: 1, width: 3 };
      mockAxiosInstance.get.mockResolvedValue({ data: mockWidget });

      const result = await client.getWidget(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/widgets/1');
      expect(result).toEqual(mockWidget);
    });
  });

  describe('createWidget', () => {
    it('should create a new widget', async () => {
      const widgetData = { dashboard_id: 1, visualization_id: 1, width: 3 };
      const mockResponse = { data: { id: 1, ...widgetData } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.createWidget(widgetData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/widgets', widgetData);
      expect(result).toEqual(mockResponse.data);
    });

    it('should send visualization_id as null for text widgets instead of omitting the key', async () => {
      // Redash's widgets.py does widget_properties.pop("visualization_id") with no default,
      // so an omitted key raises a server-side KeyError (HTTP 500) instead of the null branch.
      const widgetData = { dashboard_id: 1, text: 'Some text', width: 3 };
      const mockResponse = { data: { id: 2, ...widgetData, visualization_id: null } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.createWidget(widgetData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/widgets', {
        ...widgetData,
        visualization_id: null,
      });
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('updateWidget', () => {
    it('should update a widget', async () => {
      const updateData = { width: 6 };
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 1, ...updateData } });

      const result = await client.updateWidget(1, updateData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/widgets/1', updateData);
      expect(result.width).toBe(6);
    });
  });

  describe('deleteWidget', () => {
    it('should delete a widget', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.deleteWidget(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/widgets/1');
      expect(result).toEqual({ success: true });
    });
  });

  // Query Snippet API Tests
  describe('getQuerySnippets', () => {
    it('should fetch all query snippets', async () => {
      const mockSnippets = [{ id: 1, trigger: 'sel', snippet: 'SELECT * FROM' }];
      mockAxiosInstance.get.mockResolvedValue({ data: mockSnippets });

      const result = await client.getQuerySnippets();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/query_snippets');
      expect(result).toEqual(mockSnippets);
    });
  });

  describe('getQuerySnippet', () => {
    it('should fetch a specific query snippet', async () => {
      const mockSnippet = { id: 1, trigger: 'sel', snippet: 'SELECT * FROM' };
      mockAxiosInstance.get.mockResolvedValue({ data: mockSnippet });

      const result = await client.getQuerySnippet(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/query_snippets/1');
      expect(result).toEqual(mockSnippet);
    });
  });

  describe('createQuerySnippet', () => {
    it('should create a new query snippet', async () => {
      const snippetData = { trigger: 'sel', snippet: 'SELECT * FROM', description: 'Select all' };
      const mockResponse = { data: { id: 1, ...snippetData } };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await client.createQuerySnippet(snippetData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/query_snippets', snippetData);
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe('updateQuerySnippet', () => {
    it('should update a query snippet', async () => {
      const updateData = { snippet: 'SELECT id, name FROM' };
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 1, ...updateData } });

      const result = await client.updateQuerySnippet(1, updateData);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/query_snippets/1', updateData);
      expect(result.snippet).toBe('SELECT id, name FROM');
    });
  });

  describe('deleteQuerySnippet', () => {
    it('should delete a query snippet', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});

      const result = await client.deleteQuerySnippet(1);

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/query_snippets/1');
      expect(result).toEqual({ success: true });
    });
  });

  // Destination API Tests
  describe('getDestinations', () => {
    it('should fetch all destinations', async () => {
      const mockDestinations = [{ id: 1, name: 'Email', type: 'email' }];
      mockAxiosInstance.get.mockResolvedValue({ data: mockDestinations });

      const result = await client.getDestinations();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/destinations');
      expect(result).toEqual(mockDestinations);
    });
  });
});
