import axios, { AxiosInstance, AxiosError } from 'axios';
import * as dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

// Redash API types
export interface RedashQuery {
  id: number;
  name: string;
  description: string;
  query: string;
  data_source_id: number;
  latest_query_data_id: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  runtime: number;
  options: any;
  visualizations: RedashVisualization[];
}

// New interfaces for query creation and update
export interface CreateQueryRequest {
  name: string;
  data_source_id: number;
  query: string;
  description?: string;
  options?: any;
  schedule?: any;
  tags?: string[];
}

export interface UpdateQueryRequest {
  name?: string;
  data_source_id?: number;
  query?: string;
  description?: string;
  options?: any;
  schedule?: any;
  tags?: string[];
  is_archived?: boolean;
  is_draft?: boolean;
}

export interface RedashVisualization {
  id: number;
  type: string;
  name: string;
  description: string;
  options: any;
  query_id: number;
}

// New interfaces for visualization creation and update
export interface CreateVisualizationRequest {
  query_id: number;
  type: string;
  name: string;
  description?: string;
  options: any;
}

export interface UpdateVisualizationRequest {
  type?: string;
  name?: string;
  description?: string;
  options?: any;
}

export interface RedashQueryResult {
  id: number;
  query_id: number;
  data_source_id: number;
  query_hash: string;
  query: string;
  data: {
    columns: Array<{ name: string; type: string; friendly_name: string }>;
    rows: Array<Record<string, any>>;
  };
  runtime: number;
  retrieved_at: string;
}

export interface RedashDashboard {
  id: number;
  name: string;
  slug: string;
  tags: string[];
  is_archived: boolean;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  version: number;
  dashboard_filters_enabled: boolean;
  widgets: Array<{
    id: number;
    visualization?: {
      id: number;
      type: string;
      name: string;
      description: string;
      options: any;
      query_id: number;
    };
    text?: string;
    width: number;
    options: any;
    dashboard_id: number;
  }>;
}

export interface RedashSchema {
  schema: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
    }>;
  }>;
}

// Dashboard interfaces
export interface CreateDashboardRequest {
  name: string;
  tags?: string[];
}

export interface UpdateDashboardRequest {
  name?: string;
  tags?: string[];
  is_archived?: boolean;
  is_draft?: boolean;
  dashboard_filters_enabled?: boolean;
}

// Alert interfaces
export interface RedashAlert {
  id: number;
  name: string;
  query_id: number;
  options: {
    column: string;
    op: string;
    value: number | string;
    custom_subject?: string;
    custom_body?: string;
    muted?: boolean;
  };
  state: string;
  last_triggered_at: string | null;
  rearm: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAlertRequest {
  name: string;
  query_id: number;
  options: {
    column: string;
    op: string;
    value: number | string;
    custom_subject?: string;
    custom_body?: string;
  };
  rearm?: number | null;
}

export interface UpdateAlertRequest {
  name?: string;
  query_id?: number;
  options?: {
    column?: string;
    op?: string;
    value?: number | string;
    custom_subject?: string;
    custom_body?: string;
  };
  rearm?: number | null;
}

export interface AlertSubscription {
  id: number;
  alert_id: number;
  user?: {
    id: number;
    name: string;
    email: string;
  };
  destination?: {
    id: number;
    name: string;
    type: string;
  };
}

export interface CreateAlertSubscriptionRequest {
  destination_id?: number;
}

// Widget interfaces
export interface RedashWidget {
  id: number;
  dashboard_id: number;
  visualization_id?: number;
  visualization?: RedashVisualization;
  text?: string;
  width: number;
  options: any;
}

export interface CreateWidgetRequest {
  dashboard_id: number;
  visualization_id?: number;
  text?: string;
  width: number;
  options?: any;
}

export interface UpdateWidgetRequest {
  visualization_id?: number;
  text?: string;
  width?: number;
  options?: any;
}

// Query Snippet interfaces
export interface RedashQuerySnippet {
  id: number;
  trigger: string;
  description: string;
  snippet: string;
  created_at: string;
  updated_at: string;
}

export interface CreateQuerySnippetRequest {
  trigger: string;
  description?: string;
  snippet: string;
}

export interface UpdateQuerySnippetRequest {
  trigger?: string;
  description?: string;
  snippet?: string;
}

// Destination interface
export interface RedashDestination {
  id: number;
  name: string;
  type: string;
  options: any;
}

// Event interface
export interface RedashEvent {
  id: number;
  action: string;
  object_type: string;
  object_id: number;
  created_at: string;
  user_id: number;
}

// RedashClient class for API communication
export class RedashClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.REDASH_URL || '';
    this.apiKey = process.env.REDASH_API_KEY || '';

    if (!this.baseUrl || !this.apiKey) {
      throw new Error('REDASH_URL and REDASH_API_KEY must be provided in .env file');
    }

    const defaultHeaders: Record<string, string> = {
      'Authorization': `Key ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    const extraHeaders = this.parseExtraHeaders();

    // Prevent accidental override of Authorization header
    if (extraHeaders['Authorization'] || extraHeaders['authorization']) {
      delete extraHeaders['Authorization'];
      delete extraHeaders['authorization'];
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        ...defaultHeaders,
        ...extraHeaders,
      },
      timeout: parseInt(process.env.REDASH_TIMEOUT || '30000')
    });
  }

  // Parse extra headers from env var `REDASH_EXTRA_HEADERS`.
  // Supports JSON object or `key=value;key2=value2` format.
  private parseExtraHeaders(): Record<string, string> {
    const raw = process.env.REDASH_EXTRA_HEADERS;
    if (!raw) return {};

    // Try JSON first
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return Object.fromEntries(
          Object.entries(obj as Record<string, unknown>)
            .filter(([k, v]) => typeof k === 'string' && v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)])
        );
      }
    } catch { /* fall through to key=value parser */ }

    // Fallback: parse `key=value; key2=value2` or comma-separated
    const headers: Record<string, string> = {};
    const parts = raw.split(/[;,]/);
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (key) headers[key] = value;
    }
    return headers;
  }

  // Get all queries (with pagination)
  async getQueries(page = 1, pageSize = 25, q?: string): Promise<{ count: number; page: number; pageSize: number; results: RedashQuery[] }> {
    try {
      const response = await this.client.get('/api/queries', {
        params: { page, page_size: pageSize, q }
      });

      return {
        count: response.data.count,
        page: response.data.page,
        pageSize: response.data.page_size,
        results: response.data.results
      };
    } catch (error) {
      logger.error(`Error fetching queries: ${error}`);
      throw new Error('Failed to fetch queries from Redash');
    }
  }

  // Get a specific query by ID
  async getQuery(queryId: number): Promise<RedashQuery> {
    try {
      const response = await this.client.get(`/api/queries/${queryId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching query ${queryId}:`, error);
      throw new Error(`Failed to fetch query ${queryId} from Redash`);
    }
  }

  // Create a new query
  async createQuery(queryData: CreateQueryRequest): Promise<RedashQuery> {
    try {
      logger.info(`Creating new query: ${JSON.stringify(queryData)}`);
      logger.info(`Sending request to: ${this.baseUrl}/api/queries`);

      try {
        // Ensure we're passing the exact parameters the Redash API expects
        const requestData = {
          name: queryData.name,
          data_source_id: queryData.data_source_id,
          query: queryData.query,
          description: queryData.description || '',
          options: queryData.options || {},
          schedule: queryData.schedule || null,
          tags: queryData.tags || []
        };

        logger.info(`Request data: ${JSON.stringify(requestData)}`);
        // Avoid logging sensitive header values; log only header names
        const headerNames = Object.keys((this.client.defaults as any).headers || {});
        logger.info(`Request header names: ${JSON.stringify(headerNames)}`);
        const response = await this.client.post('/api/queries', requestData);
        logger.info(`Created query with ID: ${response.data.id}`);
        return response.data;
      } catch (axiosError: any) {
        // Log detailed axios error information
        logger.error(`Axios error in createQuery - Status: ${axiosError.response?.status || 'unknown'}`);
        logger.error(`Response data: ${JSON.stringify(axiosError.response?.data || {}, null, 2)}`);
        logger.error(`Request config: ${JSON.stringify({
          url: axiosError.config?.url,
          method: axiosError.config?.method,
          headers: axiosError.config?.headers,
          data: axiosError.config?.data
        }, null, 2)}`);

        if (axiosError.response) {
          throw new Error(`Redash API error (${axiosError.response.status}): ${JSON.stringify(axiosError.response.data)}`);
        } else if (axiosError.request) {
          throw new Error(`No response received from Redash API: ${axiosError.message}`);
        } else {
          throw axiosError;
        }
      }
    } catch (error) {
      logger.error(`Error creating query: ${error instanceof Error ? error.message : String(error)}`);
      logger.error(`Stack trace: ${error instanceof Error && error.stack ? error.stack : 'No stack trace available'}`);
      throw new Error(`Failed to create query: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Update an existing query
  async updateQuery(queryId: number, queryData: UpdateQueryRequest): Promise<RedashQuery> {
    try {
      logger.debug(`Updating query ${queryId}: ${JSON.stringify(queryData)}`);

      try {
        // Construct a request payload with only the fields we want to update
        const requestData: Record<string, any> = {};

        if (queryData.name !== undefined) requestData.name = queryData.name;
        if (queryData.data_source_id !== undefined) requestData.data_source_id = queryData.data_source_id;
        if (queryData.query !== undefined) requestData.query = queryData.query;
        if (queryData.description !== undefined) requestData.description = queryData.description;
        if (queryData.options !== undefined) requestData.options = queryData.options;
        if (queryData.schedule !== undefined) requestData.schedule = queryData.schedule;
        if (queryData.tags !== undefined) requestData.tags = queryData.tags;
        if (queryData.is_archived !== undefined) requestData.is_archived = queryData.is_archived;
        if (queryData.is_draft !== undefined) requestData.is_draft = queryData.is_draft;

        logger.debug(`Request data for update: ${JSON.stringify(requestData)}`);
        const response = await this.client.post(`/api/queries/${queryId}`, requestData);
        logger.debug(`Updated query ${queryId}`);
        return response.data;
      } catch (axiosError: any) {
        // Log detailed axios error information
        logger.error(`Axios error in updateQuery - Status: ${axiosError.response?.status || 'unknown'}`);
        logger.error(`Response data: ${JSON.stringify(axiosError.response?.data || {}, null, 2)}`);
        logger.error(`Request config: ${JSON.stringify({
          url: axiosError.config?.url,
          method: axiosError.config?.method,
          headers: axiosError.config?.headers,
          data: axiosError.config?.data
        }, null, 2)}`);

        if (axiosError.response) {
          throw new Error(`Redash API error (${axiosError.response.status}): ${JSON.stringify(axiosError.response.data)}`);
        } else if (axiosError.request) {
          throw new Error(`No response received from Redash API: ${axiosError.message}`);
        } else {
          throw axiosError;
        }
      }
    } catch (error) {
      logger.error(`Error updating query ${queryId}: ${error}`);
      throw new Error(`Failed to update query ${queryId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Archive (soft delete) a query
  async archiveQuery(queryId: number): Promise<{ success: boolean }> {
    try {
      logger.debug(`Archiving query ${queryId}`);
      await this.client.delete(`/api/queries/${queryId}`);
      logger.debug(`Archived query ${queryId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error archiving query ${queryId}: ${error}`);
      throw new Error(`Failed to archive query ${queryId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // List available data sources
  async getDataSources(): Promise<any[]> {
    try {
      const response = await this.client.get('/api/data_sources');
      return response.data;
    } catch (error) {
      logger.error(`Error fetching data sources: ${error}`);
      throw new Error('Failed to fetch data sources from Redash');
    }
  }

  // Execute a query and return results
  async executeQuery(queryId: number, parameters?: Record<string, any>): Promise<RedashQueryResult> {
    try {
      const response = await this.client.post(`/api/queries/${queryId}/results`, { parameters });

      if (response.data.job) {
        // Query is being executed asynchronously, poll for results
        return await this.pollQueryResults(response.data.job.id);
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error(`Error executing query ${queryId}: ${axiosError.message}`);

        // Extract detailed error information
        if (axiosError.response) {
          const statusCode = axiosError.response.status;
          const errorData = axiosError.response.data as any;
          const errorMessage = errorData?.message || errorData?.error || JSON.stringify(errorData);
          throw new Error(`Failed to execute query ${queryId}: Redash API error (${statusCode}): ${errorMessage}`);
        } else if (axiosError.request) {
          throw new Error(`Failed to execute query ${queryId}: No response received from Redash API: ${axiosError.message}`);
        } else {
          throw new Error(`Failed to execute query ${queryId}: ${axiosError.message}`);
        }
      } else {
        // Handle non-axios errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error executing query ${queryId}: ${errorMessage}`);
        throw new Error(`Failed to execute query ${queryId}: ${errorMessage}`);
      }
    }
  }

  // Poll for query execution results
  private async pollQueryResults(jobId: string, timeout = 60000, interval = 1000): Promise<RedashQueryResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const response = await this.client.get(`/api/jobs/${jobId}`);

        if (response.data.job.status === 3) { // Completed
          // Check if we have a query_result_id (for adhoc queries)
          if (response.data.job.query_result_id) {
            logger.debug(`Job completed with query_result_id: ${response.data.job.query_result_id}`);
            const resultResponse = await this.client.get(`/api/query_results/${response.data.job.query_result_id}`);
            return resultResponse.data;
          }
          // Otherwise, return the result directly (for normal queries)
          return response.data.job.result;
        } else if (response.data.job.status === 4) { // Error
          const errorDetails = response.data.job.error || 'Unknown error';
          throw new Error(`Query execution failed: ${errorDetails}`);
        }

        // Wait for the next poll
        await new Promise(resolve => setTimeout(resolve, interval));
      } catch (error) {
        // If this is our own error from status 4, re-throw it as-is
        if (error instanceof Error && error.message.startsWith('Query execution failed:')) {
          throw error;
        }

        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          logger.error(`Error polling for query results (job ${jobId}): ${axiosError.message}`);

          // Extract detailed error information
          if (axiosError.response) {
            const statusCode = axiosError.response.status;
            const errorData = axiosError.response.data as any;
            const errorMessage = errorData?.message || errorData?.error || JSON.stringify(errorData);
            throw new Error(`Failed to poll for query results (job ${jobId}): Redash API error (${statusCode}): ${errorMessage}`);
          } else if (axiosError.request) {
            throw new Error(`Failed to poll for query results (job ${jobId}): No response received from Redash API: ${axiosError.message}`);
          } else {
            throw new Error(`Failed to poll for query results (job ${jobId}): ${axiosError.message}`);
          }
        } else {
          // Handle non-axios errors
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Error polling for query results (job ${jobId}): ${errorMessage}`);
          throw new Error(`Failed to poll for query results (job ${jobId}): ${errorMessage}`);
        }
      }
    }

    throw new Error(`Query execution timed out after ${timeout}ms`);
  }

  // Get all dashboards
  async getDashboards(page = 1, pageSize = 25): Promise<{ count: number; page: number; pageSize: number; results: RedashDashboard[] }> {
    try {
      const response = await this.client.get('/api/dashboards', {
        params: { page, page_size: pageSize }
      });

      return {
        count: response.data.count,
        page: response.data.page,
        pageSize: response.data.page_size,
        results: response.data.results
      };
    } catch (error) {
      console.error('Error fetching dashboards:', error);
      throw new Error('Failed to fetch dashboards from Redash');
    }
  }

  // Get a specific dashboard by ID
  async getDashboard(dashboardId: number): Promise<RedashDashboard> {
    try {
      const response = await this.client.get(`/api/dashboards/${dashboardId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching dashboard ${dashboardId}:`, error);
      throw new Error(`Failed to fetch dashboard ${dashboardId} from Redash`);
    }
  }

  // Get a specific visualization by ID
  async getVisualization(visualizationId: number): Promise<RedashVisualization> {
    try {
      const response = await this.client.get(`/api/visualizations/${visualizationId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching visualization ${visualizationId}:`, error);
      throw new Error(`Failed to fetch visualization ${visualizationId} from Redash`);
    }
  }

  // Execute adhoc query directly using /api/query_results endpoint
  async executeAdhocQuery(query: string, dataSourceId: number): Promise<RedashQueryResult> {
    try {
      logger.info(`Executing adhoc query: ${query.substring(0, 100)}...`);

      // Prepare the request payload
      const payload = {
        query: query,
        data_source_id: dataSourceId,
        max_age: 0,  // Force fresh results (no cache)
        apply_auto_limit: true,  // Apply auto limit like in the web version
        parameters: {}
      };

      logger.debug(`Sending adhoc query request: ${JSON.stringify(payload)}`);

      // Execute the query directly without creating a query object
      const response = await this.client.post('/api/query_results', payload);

      // Handle async execution if job is returned
      if (response.data.job) {
        logger.debug(`Query is being executed asynchronously, job ID: ${response.data.job.id}`);
        return await this.pollQueryResults(response.data.job.id);
      }

      return response.data;

    } catch (error) {
      logger.error(`Error executing adhoc query: ${error}`);
      throw new Error(`Failed to execute adhoc query: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Create a new visualization
  async createVisualization(data: CreateVisualizationRequest): Promise<RedashVisualization> {
    try {
      const response = await this.client.post('/api/visualizations', data);
      return response.data;
    } catch (error) {
      console.error('Error creating visualization:', error);
      throw new Error('Failed to create visualization');
    }
  }

  // Update an existing visualization
  async updateVisualization(visualizationId: number, data: UpdateVisualizationRequest): Promise<RedashVisualization> {
    try {
      const response = await this.client.post(`/api/visualizations/${visualizationId}`, data);
      return response.data;
    } catch (error) {
      console.error(`Error updating visualization ${visualizationId}:`, error);
      throw new Error(`Failed to update visualization ${visualizationId}`);
    }
  }

  // Delete a visualization
  async deleteVisualization(visualizationId: number): Promise<void> {
    try {
      await this.client.delete(`/api/visualizations/${visualizationId}`);
    } catch (error) {
      console.error(`Error deleting visualization ${visualizationId}:`, error);
      throw new Error(`Failed to delete visualization ${visualizationId}`);
    }
  }

  // Get query results as CSV
  async getQueryResultsAsCsv(queryId: number, refresh = false): Promise<string> {
    try {
      // Optionally refresh the query before fetching results
      if (refresh) {
        logger.debug(`Refreshing query ${queryId} before fetching CSV results`);
        await this.executeQuery(queryId);
      }

      logger.debug(`Fetching CSV results for query ${queryId}`);
      const response = await this.client.get(`/api/queries/${queryId}/results.csv`, {
        responseType: 'text'
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        logger.error(`Error fetching CSV results for query ${queryId}: ${axiosError.message}`);

        if (axiosError.response) {
          const statusCode = axiosError.response.status;
          const errorData = axiosError.response.data;
          throw new Error(`Failed to fetch CSV results for query ${queryId}: Redash API error (${statusCode}): ${errorData}`);
        } else if (axiosError.request) {
          throw new Error(`Failed to fetch CSV results for query ${queryId}: No response received from Redash API: ${axiosError.message}`);
        } else {
          throw new Error(`Failed to fetch CSV results for query ${queryId}: ${axiosError.message}`);
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error fetching CSV results for query ${queryId}: ${errorMessage}`);
        throw new Error(`Failed to fetch CSV results for query ${queryId}: ${errorMessage}`);
      }
    }
  }

  // Get a specific data source schema by data source ID
  async getSchema(dataSourceId: number): Promise<RedashSchema> {
    try {
      const response = await this.client.get(
        `/api/data_sources/${dataSourceId}/schema`
      );
      return response.data;
    } catch (error) {
      console.error(
        `Error fetching data source ${dataSourceId} schema:`,
        error
      );
      throw new Error(
        `Failed to fetch data source ${dataSourceId} schema from Redash`
      );
    }
  }

  // ----- Dashboard API Methods -----

  // Create a new dashboard
  async createDashboard(data: CreateDashboardRequest): Promise<RedashDashboard> {
    try {
      const response = await this.client.post('/api/dashboards', data);
      return response.data;
    } catch (error) {
      logger.error(`Error creating dashboard: ${error}`);
      throw new Error(`Failed to create dashboard: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Update an existing dashboard
  async updateDashboard(dashboardId: number, data: UpdateDashboardRequest): Promise<RedashDashboard> {
    try {
      const response = await this.client.post(`/api/dashboards/${dashboardId}`, data);
      return response.data;
    } catch (error) {
      logger.error(`Error updating dashboard ${dashboardId}: ${error}`);
      throw new Error(`Failed to update dashboard ${dashboardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Archive (soft delete) a dashboard
  async archiveDashboard(dashboardId: number): Promise<{ success: boolean }> {
    try {
      await this.client.delete(`/api/dashboards/${dashboardId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error archiving dashboard ${dashboardId}: ${error}`);
      throw new Error(`Failed to archive dashboard ${dashboardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Fork a dashboard
  async forkDashboard(dashboardId: number): Promise<RedashDashboard> {
    try {
      const response = await this.client.post(`/api/dashboards/${dashboardId}/fork`);
      return response.data;
    } catch (error) {
      logger.error(`Error forking dashboard ${dashboardId}: ${error}`);
      throw new Error(`Failed to fork dashboard ${dashboardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get public dashboard by token
  async getPublicDashboard(token: string): Promise<RedashDashboard> {
    try {
      const response = await this.client.get(`/api/dashboards/public/${token}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching public dashboard: ${error}`);
      throw new Error(`Failed to fetch public dashboard: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Share a dashboard (create public link)
  async shareDashboard(dashboardId: number): Promise<{ public_url: string; api_key: string }> {
    try {
      const response = await this.client.post(`/api/dashboards/${dashboardId}/share`);
      return response.data;
    } catch (error) {
      logger.error(`Error sharing dashboard ${dashboardId}: ${error}`);
      throw new Error(`Failed to share dashboard ${dashboardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Unshare a dashboard (revoke public link)
  async unshareDashboard(dashboardId: number): Promise<{ success: boolean }> {
    try {
      await this.client.delete(`/api/dashboards/${dashboardId}/share`);
      return { success: true };
    } catch (error) {
      logger.error(`Error unsharing dashboard ${dashboardId}: ${error}`);
      throw new Error(`Failed to unshare dashboard ${dashboardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get current user's dashboards
  async getMyDashboards(page = 1, pageSize = 25): Promise<{ count: number; page: number; pageSize: number; results: RedashDashboard[] }> {
    try {
      const response = await this.client.get('/api/dashboards/my', {
        params: { page, page_size: pageSize }
      });
      return {
        count: response.data.count,
        page: response.data.page,
        pageSize: response.data.page_size,
        results: response.data.results
      };
    } catch (error) {
      logger.error(`Error fetching my dashboards: ${error}`);
      throw new Error(`Failed to fetch my dashboards: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get favorite dashboards
  async getFavoriteDashboards(page = 1, pageSize = 25): Promise<{ count: number; page: number; pageSize: number; results: RedashDashboard[] }> {
    try {
      const response = await this.client.get('/api/dashboards/favorites', {
        params: { page, page_size: pageSize }
      });
      return {
        count: response.data.count,
        page: response.data.page,
        pageSize: response.data.page_size,
        results: response.data.results
      };
    } catch (error) {
      logger.error(`Error fetching favorite dashboards: ${error}`);
      throw new Error(`Failed to fetch favorite dashboards: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Add dashboard to favorites
  async addDashboardFavorite(dashboardId: number): Promise<{ success: boolean }> {
    try {
      await this.client.post(`/api/dashboards/${dashboardId}/favorite`);
      return { success: true };
    } catch (error) {
      logger.error(`Error adding dashboard ${dashboardId} to favorites: ${error}`);
      throw new Error(`Failed to add dashboard ${dashboardId} to favorites: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Remove dashboard from favorites
  async removeDashboardFavorite(dashboardId: number): Promise<{ success: boolean }> {
    try {
      await this.client.delete(`/api/dashboards/${dashboardId}/favorite`);
      return { success: true };
    } catch (error) {
      logger.error(`Error removing dashboard ${dashboardId} from favorites: ${error}`);
      throw new Error(`Failed to remove dashboard ${dashboardId} from favorites: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get all dashboard tags
  async getDashboardTags(): Promise<{ tags: Array<{ name: string; count: number }> }> {
    try {
      const response = await this.client.get('/api/dashboards/tags');
      return response.data;
    } catch (error) {
      logger.error(`Error fetching dashboard tags: ${error}`);
      throw new Error(`Failed to fetch dashboard tags: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ----- Alert API Methods -----

  // Get all alerts
  async getAlerts(): Promise<RedashAlert[]> {
    try {
      const response = await this.client.get('/api/alerts');
      return response.data;
    } catch (error) {
      logger.error(`Error fetching alerts: ${error}`);
      throw new Error(`Failed to fetch alerts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get a specific alert by ID
  async getAlert(alertId: number): Promise<RedashAlert> {
    try {
      const response = await this.client.get(`/api/alerts/${alertId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching alert ${alertId}: ${error}`);
      throw new Error(`Failed to fetch alert ${alertId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Create a new alert
  async createAlert(data: CreateAlertRequest): Promise<RedashAlert> {
    try {
      const response = await this.client.post('/api/alerts', data);
      return response.data;
    } catch (error) {
      logger.error(`Error creating alert: ${error}`);
      throw new Error(`Failed to create alert: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Update an existing alert
  async updateAlert(alertId: number, data: UpdateAlertRequest): Promise<RedashAlert> {
    try {
      const response = await this.client.post(`/api/alerts/${alertId}`, data);
      return response.data;
    } catch (error) {
      logger.error(`Error updating alert ${alertId}: ${error}`);
      throw new Error(`Failed to update alert ${alertId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Delete an alert
  async deleteAlert(alertId: number): Promise<{ success: boolean }> {
    try {
      await this.client.delete(`/api/alerts/${alertId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error deleting alert ${alertId}: ${error}`);
      throw new Error(`Failed to delete alert ${alertId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Mute an alert
  async muteAlert(alertId: number): Promise<{ success: boolean }> {
    try {
      await this.client.post(`/api/alerts/${alertId}/mute`);
      return { success: true };
    } catch (error) {
      logger.error(`Error muting alert ${alertId}: ${error}`);
      throw new Error(`Failed to mute alert ${alertId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get alert subscriptions
  async getAlertSubscriptions(alertId: number): Promise<AlertSubscription[]> {
    try {
      const response = await this.client.get(`/api/alerts/${alertId}/subscriptions`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching alert ${alertId} subscriptions: ${error}`);
      throw new Error(`Failed to fetch alert ${alertId} subscriptions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Add alert subscription
  async addAlertSubscription(alertId: number, data?: CreateAlertSubscriptionRequest): Promise<AlertSubscription> {
    try {
      const response = await this.client.post(`/api/alerts/${alertId}/subscriptions`, data || {});
      return response.data;
    } catch (error) {
      logger.error(`Error adding subscription to alert ${alertId}: ${error}`);
      throw new Error(`Failed to add subscription to alert ${alertId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Remove alert subscription
  async removeAlertSubscription(alertId: number, subscriptionId: number): Promise<{ success: boolean }> {
    try {
      await this.client.delete(`/api/alerts/${alertId}/subscriptions/${subscriptionId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error removing subscription ${subscriptionId} from alert ${alertId}: ${error}`);
      throw new Error(`Failed to remove subscription ${subscriptionId} from alert ${alertId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ----- Additional Query API Methods -----

  // Fork a query
  async forkQuery(queryId: number): Promise<RedashQuery> {
    try {
      const response = await this.client.post(`/api/queries/${queryId}/fork`);
      return response.data;
    } catch (error) {
      logger.error(`Error forking query ${queryId}: ${error}`);
      throw new Error(`Failed to fork query ${queryId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get current user's queries
  async getMyQueries(page = 1, pageSize = 25): Promise<{ count: number; page: number; pageSize: number; results: RedashQuery[] }> {
    try {
      const response = await this.client.get('/api/queries/my', {
        params: { page, page_size: pageSize }
      });
      return {
        count: response.data.count,
        page: response.data.page,
        pageSize: response.data.page_size,
        results: response.data.results
      };
    } catch (error) {
      logger.error(`Error fetching my queries: ${error}`);
      throw new Error(`Failed to fetch my queries: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get recent queries
  async getRecentQueries(page = 1, pageSize = 25): Promise<{ count: number; page: number; pageSize: number; results: RedashQuery[] }> {
    try {
      const response = await this.client.get('/api/queries/recent', {
        params: { page, page_size: pageSize }
      });
      return {
        count: response.data.count,
        page: response.data.page,
        pageSize: response.data.page_size,
        results: response.data.results
      };
    } catch (error) {
      logger.error(`Error fetching recent queries: ${error}`);
      throw new Error(`Failed to fetch recent queries: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get query tags
  async getQueryTags(): Promise<{ tags: Array<{ name: string; count: number }> }> {
    try {
      const response = await this.client.get('/api/queries/tags');
      return response.data;
    } catch (error) {
      logger.error(`Error fetching query tags: ${error}`);
      throw new Error(`Failed to fetch query tags: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get favorite queries
  async getFavoriteQueries(page = 1, pageSize = 25): Promise<{ count: number; page: number; pageSize: number; results: RedashQuery[] }> {
    try {
      const response = await this.client.get('/api/queries/favorites', {
        params: { page, page_size: pageSize }
      });
      return {
        count: response.data.count,
        page: response.data.page,
        pageSize: response.data.page_size,
        results: response.data.results
      };
    } catch (error) {
      logger.error(`Error fetching favorite queries: ${error}`);
      throw new Error(`Failed to fetch favorite queries: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Add query to favorites
  async addQueryFavorite(queryId: number): Promise<{ success: boolean }> {
    try {
      await this.client.post(`/api/queries/${queryId}/favorite`);
      return { success: true };
    } catch (error) {
      logger.error(`Error adding query ${queryId} to favorites: ${error}`);
      throw new Error(`Failed to add query ${queryId} to favorites: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Remove query from favorites
  async removeQueryFavorite(queryId: number): Promise<{ success: boolean }> {
    try {
      await this.client.delete(`/api/queries/${queryId}/favorite`);
      return { success: true };
    } catch (error) {
      logger.error(`Error removing query ${queryId} from favorites: ${error}`);
      throw new Error(`Failed to remove query ${queryId} from favorites: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ----- Widget API Methods -----

  // Get all widgets
  async getWidgets(): Promise<RedashWidget[]> {
    try {
      const response = await this.client.get('/api/widgets');
      return response.data;
    } catch (error) {
      logger.error(`Error fetching widgets: ${error}`);
      throw new Error(`Failed to fetch widgets: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get a specific widget by ID
  async getWidget(widgetId: number): Promise<RedashWidget> {
    try {
      const response = await this.client.get(`/api/widgets/${widgetId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching widget ${widgetId}: ${error}`);
      throw new Error(`Failed to fetch widget ${widgetId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Create a new widget
  async createWidget(data: CreateWidgetRequest): Promise<RedashWidget> {
    try {
      const response = await this.client.post('/api/widgets', data);
      return response.data;
    } catch (error) {
      logger.error(`Error creating widget: ${error}`);
      throw new Error(`Failed to create widget: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Update an existing widget
  async updateWidget(widgetId: number, data: UpdateWidgetRequest): Promise<RedashWidget> {
    try {
      const response = await this.client.post(`/api/widgets/${widgetId}`, data);
      return response.data;
    } catch (error) {
      logger.error(`Error updating widget ${widgetId}: ${error}`);
      throw new Error(`Failed to update widget ${widgetId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Delete a widget
  async deleteWidget(widgetId: number): Promise<{ success: boolean }> {
    try {
      await this.client.delete(`/api/widgets/${widgetId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error deleting widget ${widgetId}: ${error}`);
      throw new Error(`Failed to delete widget ${widgetId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ----- Query Snippet API Methods -----

  // Get all query snippets
  async getQuerySnippets(): Promise<RedashQuerySnippet[]> {
    try {
      const response = await this.client.get('/api/query_snippets');
      return response.data;
    } catch (error) {
      logger.error(`Error fetching query snippets: ${error}`);
      throw new Error(`Failed to fetch query snippets: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Get a specific query snippet by ID
  async getQuerySnippet(snippetId: number): Promise<RedashQuerySnippet> {
    try {
      const response = await this.client.get(`/api/query_snippets/${snippetId}`);
      return response.data;
    } catch (error) {
      logger.error(`Error fetching query snippet ${snippetId}: ${error}`);
      throw new Error(`Failed to fetch query snippet ${snippetId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Create a new query snippet
  async createQuerySnippet(data: CreateQuerySnippetRequest): Promise<RedashQuerySnippet> {
    try {
      const response = await this.client.post('/api/query_snippets', data);
      return response.data;
    } catch (error) {
      logger.error(`Error creating query snippet: ${error}`);
      throw new Error(`Failed to create query snippet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Update an existing query snippet
  async updateQuerySnippet(snippetId: number, data: UpdateQuerySnippetRequest): Promise<RedashQuerySnippet> {
    try {
      const response = await this.client.post(`/api/query_snippets/${snippetId}`, data);
      return response.data;
    } catch (error) {
      logger.error(`Error updating query snippet ${snippetId}: ${error}`);
      throw new Error(`Failed to update query snippet ${snippetId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Delete a query snippet
  async deleteQuerySnippet(snippetId: number): Promise<{ success: boolean }> {
    try {
      await this.client.delete(`/api/query_snippets/${snippetId}`);
      return { success: true };
    } catch (error) {
      logger.error(`Error deleting query snippet ${snippetId}: ${error}`);
      throw new Error(`Failed to delete query snippet ${snippetId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ----- Destination API Methods -----

  // Get all destinations
  async getDestinations(): Promise<RedashDestination[]> {
    try {
      const response = await this.client.get('/api/destinations');
      return response.data;
    } catch (error) {
      logger.error(`Error fetching destinations: ${error}`);
      throw new Error(`Failed to fetch destinations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ----- Event API Methods -----

  // Get events
  async getEvents(page = 1, pageSize = 25): Promise<{ count: number; page: number; pageSize: number; results: RedashEvent[] }> {
    try {
      const response = await this.client.get('/api/events', {
        params: { page, page_size: pageSize }
      });
      return {
        count: response.data.count,
        page: response.data.page,
        pageSize: response.data.page_size,
        results: response.data.results
      };
    } catch (error) {
      logger.error(`Error fetching events: ${error}`);
      throw new Error(`Failed to fetch events: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Export a singleton instance
export const redashClient = new RedashClient();
