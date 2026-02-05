// Set environment variables before any imports
process.env.REDASH_URL = 'https://redash.example.com';
process.env.REDASH_API_KEY = 'test-api-key';
process.env.REDASH_TIMEOUT = '30000';

import { RedashClient } from '../redashClient.js';
import axios from 'axios';
import { jest } from '@jest/globals';

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

describe('RedashClient', () => {
  let client: RedashClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset environment variables
    process.env.REDASH_URL = 'https://redash.example.com';
    process.env.REDASH_API_KEY = 'test-api-key';
    process.env.REDASH_TIMEOUT = '30000';
    delete process.env.REDASH_EXTRA_HEADERS;

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
        { parameters: undefined }
      );
      expect(result).toEqual(mockResult);
    });

    it('should execute a query with parameters', async () => {
      const params = { date: '2024-01-01' };
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await client.executeQuery(123, params);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/queries/123/results',
        { parameters: params }
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
        })
      );
      expect(result).toEqual(mockResult);
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

  describe('getSchema', () => {
    it('should fetch data source schema', async () => {
      const mockSchema = {
        schema: [
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'integer' },
              { name: 'email', type: 'string' },
            ],
          },
        ],
      };

      mockAxiosInstance.get.mockResolvedValue({ data: mockSchema });

      const result = await client.getSchema(1);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/data_sources/1/schema');
      expect(result).toEqual(mockSchema);
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
