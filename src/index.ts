#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as dotenv from 'dotenv';
import { redashClient, CreateQueryRequest, UpdateQueryRequest, CreateVisualizationRequest, UpdateVisualizationRequest, CreateDashboardRequest, UpdateDashboardRequest, CreateAlertRequest, UpdateAlertRequest, CreateAlertSubscriptionRequest, CreateWidgetRequest, UpdateWidgetRequest, CreateQuerySnippetRequest, UpdateQuerySnippetRequest } from "./redashClient.js";
import { logger, LogLevel } from "./logger.js";

// Load environment variables
dotenv.config();

// Create MCP server instance
const server = new Server(
  {
    name: "redash-mcp",
    version: "1.1.0"
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

// Set up server logging
logger.info('Starting Redash MCP server...');

// ----- Tools Implementation -----

// Tool: get_query
const getQuerySchema = z.object({
  queryId: z.number()
});

async function getQuery(params: z.infer<typeof getQuerySchema>) {
  try {
    const { queryId } = params;
    const query = await redashClient.getQuery(queryId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(query, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error getting query ${params.queryId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting query ${params.queryId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: create_query
const createQuerySchema = z.object({
  name: z.string(),
  data_source_id: z.number(),
  query: z.string(),
  description: z.string().optional(),
  options: z.any().optional(),
  schedule: z.any().optional(),
  tags: z.array(z.string()).optional()
});

async function createQuery(params: z.infer<typeof createQuerySchema>) {
  try {
    logger.debug(`Create query params: ${JSON.stringify(params)}`);

    // Convert params to CreateQueryRequest with proper defaults
    const queryData: CreateQueryRequest = {
      name: params.name,
      data_source_id: params.data_source_id,
      query: params.query,
      description: params.description || '',
      options: params.options || {},
      schedule: params.schedule || null,
      tags: params.tags || []
    };

    logger.debug(`Calling redashClient.createQuery with data: ${JSON.stringify(queryData)}`);
    const result = await redashClient.createQuery(queryData);
    logger.debug(`Create query result: ${JSON.stringify(result)}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error creating query: ${error instanceof Error ? error.message : String(error)}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error creating query: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: update_query
const updateQuerySchema = z.object({
  queryId: z.number(),
  name: z.string().optional(),
  data_source_id: z.number().optional(),
  query: z.string().optional(),
  description: z.string().optional(),
  options: z.any().optional(),
  schedule: z.any().optional(),
  tags: z.array(z.string()).optional(),
  is_archived: z.boolean().optional(),
  is_draft: z.boolean().optional()
});

async function updateQuery(params: z.infer<typeof updateQuerySchema>) {
  try {
    const { queryId, ...updateData } = params;

    logger.debug(`Update query ${queryId} params: ${JSON.stringify(updateData)}`);

    // Convert params to UpdateQueryRequest - only include non-undefined fields
    const queryData: UpdateQueryRequest = {};

    // Only add fields that are defined
    if (updateData.name !== undefined) queryData.name = updateData.name;
    if (updateData.data_source_id !== undefined) queryData.data_source_id = updateData.data_source_id;
    if (updateData.query !== undefined) queryData.query = updateData.query;
    if (updateData.description !== undefined) queryData.description = updateData.description;
    if (updateData.options !== undefined) queryData.options = updateData.options;
    if (updateData.schedule !== undefined) queryData.schedule = updateData.schedule;
    if (updateData.tags !== undefined) queryData.tags = updateData.tags;
    if (updateData.is_archived !== undefined) queryData.is_archived = updateData.is_archived;
    if (updateData.is_draft !== undefined) queryData.is_draft = updateData.is_draft;

    logger.debug(`Calling redashClient.updateQuery with data: ${JSON.stringify(queryData)}`);
    const result = await redashClient.updateQuery(queryId, queryData);
    logger.debug(`Update query result: ${JSON.stringify(result)}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error updating query ${params.queryId}: ${error instanceof Error ? error.message : String(error)}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error updating query ${params.queryId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: archive_query
const archiveQuerySchema = z.object({
  queryId: z.number()
});

async function archiveQuery(params: z.infer<typeof archiveQuerySchema>) {
  try {
    const { queryId } = params;
    const result = await redashClient.archiveQuery(queryId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error archiving query ${params.queryId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error archiving query ${params.queryId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: list_data_sources
async function listDataSources() {
  try {
    const dataSources = await redashClient.getDataSources();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(dataSources, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error listing data sources: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error listing data sources: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: list_queries
const listQueriesSchema = z.object({
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(25),
  q: z.string().optional()
});

async function listQueries(params: z.infer<typeof listQueriesSchema>) {
  try {
    const { page, pageSize, q } = params;
    const queries = await redashClient.getQueries(page, pageSize, q);

    logger.debug(`Listed ${queries.results.length} queries`);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(queries, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error listing queries: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error listing queries: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: execute_query
const executeQuerySchema = z.object({
  queryId: z.number(),
  parameters: z.record(z.any()).optional()
});

async function executeQuery(params: z.infer<typeof executeQuerySchema>) {
  try {
    const { queryId, parameters } = params;
    const result = await redashClient.executeQuery(queryId, parameters);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error(`Error executing query ${params.queryId}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing query ${params.queryId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: get_query_results_csv
const getQueryResultsCsvSchema = z.object({
  queryId: z.number(),
  refresh: z.boolean().optional().default(false)
});

async function getQueryResultsCsv(params: z.infer<typeof getQueryResultsCsvSchema>) {
  try {
    const { queryId, refresh } = params;
    const csv = await redashClient.getQueryResultsAsCsv(queryId, refresh);

    return {
      content: [
        {
          type: "text",
          text: csv
        }
      ]
    };
  } catch (error) {
    logger.error(`Error getting CSV results for query ${params.queryId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting CSV results for query ${params.queryId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: list_dashboards
const listDashboardsSchema = z.object({
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(25)
});

async function listDashboards(params: z.infer<typeof listDashboardsSchema>) {
  try {
    const { page, pageSize } = params;
    const dashboards = await redashClient.getDashboards(page, pageSize);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(dashboards, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error('Error listing dashboards:', error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error listing dashboards: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: get_dashboard
const getDashboardSchema = z.object({
  dashboardId: z.number()
});

async function getDashboard(params: z.infer<typeof getDashboardSchema>) {
  try {
    const { dashboardId } = params;
    const dashboard = await redashClient.getDashboard(dashboardId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(dashboard, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error(`Error getting dashboard ${params.dashboardId}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting dashboard ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: get_visualization
const getVisualizationSchema = z.object({
  visualizationId: z.number()
});

async function getVisualization(params: z.infer<typeof getVisualizationSchema>) {
  try {
    const { visualizationId } = params;
    const visualization = await redashClient.getVisualization(visualizationId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(visualization, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error(`Error getting visualization ${params.visualizationId}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting visualization ${params.visualizationId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: execute_adhoc_query
const executeAdhocQuerySchema = z.object({
  query: z.string(),
  dataSourceId: z.number()
});

async function executeAdhocQuery(params: z.infer<typeof executeAdhocQuerySchema>) {
  try {
    const { query, dataSourceId } = params;
    const result = await redashClient.executeAdhocQuery(query, dataSourceId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error executing adhoc query: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing adhoc query: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: create_visualization
const createVisualizationSchema = z.object({
  query_id: z.number(),
  type: z.string(),
  name: z.string(),
  description: z.string().optional(),
  options: z.any()
});

async function createVisualization(params: z.infer<typeof createVisualizationSchema>) {
  try {
    const visualizationData: CreateVisualizationRequest = {
      query_id: params.query_id,
      type: params.type,
      name: params.name,
      description: params.description,
      options: params.options
    };

    const result = await redashClient.createVisualization(visualizationData);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error('Error creating visualization:', error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error creating visualization: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: update_visualization
const updateVisualizationSchema = z.object({
  visualizationId: z.number(),
  type: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  options: z.any().optional()
});

async function updateVisualization(params: z.infer<typeof updateVisualizationSchema>) {
  try {
    const { visualizationId, ...updateData } = params;
    const result = await redashClient.updateVisualization(visualizationId, updateData);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    console.error(`Error updating visualization ${params.visualizationId}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error updating visualization ${params.visualizationId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: delete_visualization
const deleteVisualizationSchema = z.object({
  visualizationId: z.number()
});

async function deleteVisualization(params: z.infer<typeof deleteVisualizationSchema>) {
  try {
    const { visualizationId } = params;
    await redashClient.deleteVisualization(visualizationId);

    return {
      content: [
        {
          type: "text",
          text: `Visualization ${visualizationId} deleted successfully`
        }
      ]
    };
  } catch (error) {
    console.error(`Error deleting visualization ${params.visualizationId}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error deleting visualization ${params.visualizationId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: get_schema
const getSchemaSchema = z.object({
  dataSourceId: z.number(),
});

async function getSchema(params: z.infer<typeof getSchemaSchema>) {
  try {
    const { dataSourceId } = params;
    const query = await redashClient.getSchema(dataSourceId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(query, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error(
      `Error getting data source ${params.dataSourceId} schema: ${error}`
    );
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting data source ${params.dataSourceId} schema: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
    };
  }
}

// ----- Dashboard Tools -----

// Tool: create_dashboard
const createDashboardSchema = z.object({
  name: z.string(),
  tags: z.array(z.string()).optional()
});

async function createDashboard(params: z.infer<typeof createDashboardSchema>) {
  try {
    const dashboardData: CreateDashboardRequest = {
      name: params.name,
      tags: params.tags || []
    };
    const result = await redashClient.createDashboard(dashboardData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error creating dashboard: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error creating dashboard: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: update_dashboard
const updateDashboardSchema = z.object({
  dashboardId: z.number(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  is_archived: z.boolean().optional(),
  is_draft: z.boolean().optional(),
  dashboard_filters_enabled: z.boolean().optional()
});

async function updateDashboard(params: z.infer<typeof updateDashboardSchema>) {
  try {
    const { dashboardId, ...updateData } = params;
    const dashboardData: UpdateDashboardRequest = {};
    if (updateData.name !== undefined) dashboardData.name = updateData.name;
    if (updateData.tags !== undefined) dashboardData.tags = updateData.tags;
    if (updateData.is_archived !== undefined) dashboardData.is_archived = updateData.is_archived;
    if (updateData.is_draft !== undefined) dashboardData.is_draft = updateData.is_draft;
    if (updateData.dashboard_filters_enabled !== undefined) dashboardData.dashboard_filters_enabled = updateData.dashboard_filters_enabled;

    const result = await redashClient.updateDashboard(dashboardId, dashboardData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error updating dashboard ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error updating dashboard ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: archive_dashboard
const archiveDashboardSchema = z.object({
  dashboardId: z.number()
});

async function archiveDashboard(params: z.infer<typeof archiveDashboardSchema>) {
  try {
    const result = await redashClient.archiveDashboard(params.dashboardId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error archiving dashboard ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error archiving dashboard ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: fork_dashboard
const forkDashboardSchema = z.object({
  dashboardId: z.number()
});

async function forkDashboard(params: z.infer<typeof forkDashboardSchema>) {
  try {
    const result = await redashClient.forkDashboard(params.dashboardId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error forking dashboard ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error forking dashboard ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_public_dashboard
const getPublicDashboardSchema = z.object({
  token: z.string()
});

async function getPublicDashboard(params: z.infer<typeof getPublicDashboardSchema>) {
  try {
    const result = await redashClient.getPublicDashboard(params.token);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error fetching public dashboard: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error fetching public dashboard: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: share_dashboard
const shareDashboardSchema = z.object({
  dashboardId: z.number()
});

async function shareDashboard(params: z.infer<typeof shareDashboardSchema>) {
  try {
    const result = await redashClient.shareDashboard(params.dashboardId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error sharing dashboard ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error sharing dashboard ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: unshare_dashboard
const unshareDashboardSchema = z.object({
  dashboardId: z.number()
});

async function unshareDashboard(params: z.infer<typeof unshareDashboardSchema>) {
  try {
    const result = await redashClient.unshareDashboard(params.dashboardId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error unsharing dashboard ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error unsharing dashboard ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_my_dashboards
const getMyDashboardsSchema = z.object({
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(25)
});

async function getMyDashboards(params: z.infer<typeof getMyDashboardsSchema>) {
  try {
    const result = await redashClient.getMyDashboards(params.page, params.pageSize);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error fetching my dashboards: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error fetching my dashboards: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_favorite_dashboards
const getFavoriteDashboardsSchema = z.object({
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(25)
});

async function getFavoriteDashboards(params: z.infer<typeof getFavoriteDashboardsSchema>) {
  try {
    const result = await redashClient.getFavoriteDashboards(params.page, params.pageSize);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error fetching favorite dashboards: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error fetching favorite dashboards: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: add_dashboard_favorite
const addDashboardFavoriteSchema = z.object({
  dashboardId: z.number()
});

async function addDashboardFavorite(params: z.infer<typeof addDashboardFavoriteSchema>) {
  try {
    const result = await redashClient.addDashboardFavorite(params.dashboardId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error adding dashboard ${params.dashboardId} to favorites: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error adding dashboard ${params.dashboardId} to favorites: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: remove_dashboard_favorite
const removeDashboardFavoriteSchema = z.object({
  dashboardId: z.number()
});

async function removeDashboardFavorite(params: z.infer<typeof removeDashboardFavoriteSchema>) {
  try {
    const result = await redashClient.removeDashboardFavorite(params.dashboardId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error removing dashboard ${params.dashboardId} from favorites: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error removing dashboard ${params.dashboardId} from favorites: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_dashboard_tags
async function getDashboardTags() {
  try {
    const result = await redashClient.getDashboardTags();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error fetching dashboard tags: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error fetching dashboard tags: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// ----- Alert Tools -----

// Tool: list_alerts
async function listAlerts() {
  try {
    const result = await redashClient.getAlerts();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error listing alerts: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error listing alerts: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_alert
const getAlertSchema = z.object({
  alertId: z.number()
});

async function getAlert(params: z.infer<typeof getAlertSchema>) {
  try {
    const result = await redashClient.getAlert(params.alertId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error getting alert ${params.alertId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting alert ${params.alertId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: create_alert
const createAlertSchema = z.object({
  name: z.string(),
  query_id: z.number(),
  options: z.object({
    column: z.string(),
    op: z.string(),
    value: z.union([z.number(), z.string()]),
    custom_subject: z.string().optional(),
    custom_body: z.string().optional()
  }),
  rearm: z.number().nullable().optional()
});

async function createAlert(params: z.infer<typeof createAlertSchema>) {
  try {
    const alertData: CreateAlertRequest = {
      name: params.name,
      query_id: params.query_id,
      options: params.options,
      rearm: params.rearm
    };
    const result = await redashClient.createAlert(alertData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error creating alert: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error creating alert: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: update_alert
const updateAlertSchema = z.object({
  alertId: z.number(),
  name: z.string().optional(),
  query_id: z.number().optional(),
  options: z.object({
    column: z.string().optional(),
    op: z.string().optional(),
    value: z.union([z.number(), z.string()]).optional(),
    custom_subject: z.string().optional(),
    custom_body: z.string().optional()
  }).optional(),
  rearm: z.number().nullable().optional()
});

async function updateAlert(params: z.infer<typeof updateAlertSchema>) {
  try {
    const { alertId, ...updateData } = params;
    const alertData: UpdateAlertRequest = {};
    if (updateData.name !== undefined) alertData.name = updateData.name;
    if (updateData.query_id !== undefined) alertData.query_id = updateData.query_id;
    if (updateData.options !== undefined) alertData.options = updateData.options;
    if (updateData.rearm !== undefined) alertData.rearm = updateData.rearm;

    const result = await redashClient.updateAlert(alertId, alertData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error updating alert ${params.alertId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error updating alert ${params.alertId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: delete_alert
const deleteAlertSchema = z.object({
  alertId: z.number()
});

async function deleteAlert(params: z.infer<typeof deleteAlertSchema>) {
  try {
    const result = await redashClient.deleteAlert(params.alertId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error deleting alert ${params.alertId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error deleting alert ${params.alertId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: mute_alert
const muteAlertSchema = z.object({
  alertId: z.number()
});

async function muteAlert(params: z.infer<typeof muteAlertSchema>) {
  try {
    const result = await redashClient.muteAlert(params.alertId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error muting alert ${params.alertId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error muting alert ${params.alertId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_alert_subscriptions
const getAlertSubscriptionsSchema = z.object({
  alertId: z.number()
});

async function getAlertSubscriptions(params: z.infer<typeof getAlertSubscriptionsSchema>) {
  try {
    const result = await redashClient.getAlertSubscriptions(params.alertId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error getting alert ${params.alertId} subscriptions: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting alert ${params.alertId} subscriptions: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: add_alert_subscription
const addAlertSubscriptionSchema = z.object({
  alertId: z.number(),
  destination_id: z.number().optional()
});

async function addAlertSubscription(params: z.infer<typeof addAlertSubscriptionSchema>) {
  try {
    const subscriptionData: CreateAlertSubscriptionRequest = {};
    if (params.destination_id !== undefined) subscriptionData.destination_id = params.destination_id;

    const result = await redashClient.addAlertSubscription(params.alertId, subscriptionData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error adding subscription to alert ${params.alertId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error adding subscription to alert ${params.alertId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: remove_alert_subscription
const removeAlertSubscriptionSchema = z.object({
  alertId: z.number(),
  subscriptionId: z.number()
});

async function removeAlertSubscription(params: z.infer<typeof removeAlertSubscriptionSchema>) {
  try {
    const result = await redashClient.removeAlertSubscription(params.alertId, params.subscriptionId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error removing subscription ${params.subscriptionId} from alert ${params.alertId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error removing subscription ${params.subscriptionId} from alert ${params.alertId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// ----- Additional Query Tools -----

// Tool: fork_query
const forkQuerySchema = z.object({
  queryId: z.number()
});

async function forkQuery(params: z.infer<typeof forkQuerySchema>) {
  try {
    const result = await redashClient.forkQuery(params.queryId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error forking query ${params.queryId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error forking query ${params.queryId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_my_queries
const getMyQueriesSchema = z.object({
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(25)
});

async function getMyQueries(params: z.infer<typeof getMyQueriesSchema>) {
  try {
    const result = await redashClient.getMyQueries(params.page, params.pageSize);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error fetching my queries: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error fetching my queries: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_recent_queries
const getRecentQueriesSchema = z.object({
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(25)
});

async function getRecentQueries(params: z.infer<typeof getRecentQueriesSchema>) {
  try {
    const result = await redashClient.getRecentQueries(params.page, params.pageSize);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error fetching recent queries: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error fetching recent queries: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_query_tags
async function getQueryTags() {
  try {
    const result = await redashClient.getQueryTags();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error fetching query tags: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error fetching query tags: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_favorite_queries
const getFavoriteQueriesSchema = z.object({
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(25)
});

async function getFavoriteQueries(params: z.infer<typeof getFavoriteQueriesSchema>) {
  try {
    const result = await redashClient.getFavoriteQueries(params.page, params.pageSize);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error fetching favorite queries: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error fetching favorite queries: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: add_query_favorite
const addQueryFavoriteSchema = z.object({
  queryId: z.number()
});

async function addQueryFavorite(params: z.infer<typeof addQueryFavoriteSchema>) {
  try {
    const result = await redashClient.addQueryFavorite(params.queryId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error adding query ${params.queryId} to favorites: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error adding query ${params.queryId} to favorites: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: remove_query_favorite
const removeQueryFavoriteSchema = z.object({
  queryId: z.number()
});

async function removeQueryFavorite(params: z.infer<typeof removeQueryFavoriteSchema>) {
  try {
    const result = await redashClient.removeQueryFavorite(params.queryId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error removing query ${params.queryId} from favorites: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error removing query ${params.queryId} from favorites: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// ----- Widget Tools -----

// Tool: list_widgets
async function listWidgets() {
  try {
    const result = await redashClient.getWidgets();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error listing widgets: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error listing widgets: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_widget
const getWidgetSchema = z.object({
  widgetId: z.number()
});

async function getWidget(params: z.infer<typeof getWidgetSchema>) {
  try {
    const result = await redashClient.getWidget(params.widgetId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error getting widget ${params.widgetId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting widget ${params.widgetId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: create_widget
const createWidgetSchema = z.object({
  dashboard_id: z.number(),
  visualization_id: z.number().optional(),
  text: z.string().optional(),
  width: z.number(),
  options: z.any().optional()
});

async function createWidget(params: z.infer<typeof createWidgetSchema>) {
  try {
    const widgetData: CreateWidgetRequest = {
      dashboard_id: params.dashboard_id,
      visualization_id: params.visualization_id,
      text: params.text,
      width: params.width,
      options: params.options || {}
    };
    const result = await redashClient.createWidget(widgetData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error creating widget: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error creating widget: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: update_widget
const updateWidgetSchema = z.object({
  widgetId: z.number(),
  visualization_id: z.number().optional(),
  text: z.string().optional(),
  width: z.number().optional(),
  options: z.any().optional()
});

async function updateWidget(params: z.infer<typeof updateWidgetSchema>) {
  try {
    const { widgetId, ...updateData } = params;
    const widgetData: UpdateWidgetRequest = {};
    if (updateData.visualization_id !== undefined) widgetData.visualization_id = updateData.visualization_id;
    if (updateData.text !== undefined) widgetData.text = updateData.text;
    if (updateData.width !== undefined) widgetData.width = updateData.width;
    if (updateData.options !== undefined) widgetData.options = updateData.options;

    const result = await redashClient.updateWidget(widgetId, widgetData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error updating widget ${params.widgetId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error updating widget ${params.widgetId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: delete_widget
const deleteWidgetSchema = z.object({
  widgetId: z.number()
});

async function deleteWidget(params: z.infer<typeof deleteWidgetSchema>) {
  try {
    const result = await redashClient.deleteWidget(params.widgetId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error deleting widget ${params.widgetId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error deleting widget ${params.widgetId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// ----- Query Snippet Tools -----

// Tool: list_query_snippets
async function listQuerySnippets() {
  try {
    const result = await redashClient.getQuerySnippets();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error listing query snippets: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error listing query snippets: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_query_snippet
const getQuerySnippetSchema = z.object({
  snippetId: z.number()
});

async function getQuerySnippet(params: z.infer<typeof getQuerySnippetSchema>) {
  try {
    const result = await redashClient.getQuerySnippet(params.snippetId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error getting query snippet ${params.snippetId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting query snippet ${params.snippetId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: create_query_snippet
const createQuerySnippetSchema = z.object({
  trigger: z.string(),
  description: z.string().optional(),
  snippet: z.string()
});

async function createQuerySnippet(params: z.infer<typeof createQuerySnippetSchema>) {
  try {
    const snippetData: CreateQuerySnippetRequest = {
      trigger: params.trigger,
      description: params.description,
      snippet: params.snippet
    };
    const result = await redashClient.createQuerySnippet(snippetData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error creating query snippet: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error creating query snippet: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: update_query_snippet
const updateQuerySnippetSchema = z.object({
  snippetId: z.number(),
  trigger: z.string().optional(),
  description: z.string().optional(),
  snippet: z.string().optional()
});

async function updateQuerySnippet(params: z.infer<typeof updateQuerySnippetSchema>) {
  try {
    const { snippetId, ...updateData } = params;
    const snippetData: UpdateQuerySnippetRequest = {};
    if (updateData.trigger !== undefined) snippetData.trigger = updateData.trigger;
    if (updateData.description !== undefined) snippetData.description = updateData.description;
    if (updateData.snippet !== undefined) snippetData.snippet = updateData.snippet;

    const result = await redashClient.updateQuerySnippet(snippetId, snippetData);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error updating query snippet ${params.snippetId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error updating query snippet ${params.snippetId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: delete_query_snippet
const deleteQuerySnippetSchema = z.object({
  snippetId: z.number()
});

async function deleteQuerySnippet(params: z.infer<typeof deleteQuerySnippetSchema>) {
  try {
    const result = await redashClient.deleteQuerySnippet(params.snippetId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error deleting query snippet ${params.snippetId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error deleting query snippet ${params.snippetId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// ----- Destination Tools -----

// Tool: list_destinations
async function listDestinations() {
  try {
    const result = await redashClient.getDestinations();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error listing destinations: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error listing destinations: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}


// ----- Resources Implementation -----

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    // List queries as resources
    const queries = await redashClient.getQueries(1, 100);
    const queryResources = queries.results.map(query => ({
      uri: `redash://query/${query.id}`,
      name: query.name,
      description: query.description || `Query ID: ${query.id}`
    }));

    // List dashboards as resources
    const dashboards = await redashClient.getDashboards(1, 100);
    const dashboardResources = dashboards.results.map(dashboard => ({
      uri: `redash://dashboard/${dashboard.id}`,
      name: dashboard.name,
      description: `Dashboard ID: ${dashboard.id}`
    }));

    return {
      resources: [...queryResources, ...dashboardResources]
    };
  } catch (error) {
    console.error('Error listing resources:', error);
    return {
      resources: []
    };
  }
});

// Read resource content
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  try {
    const match = uri.match(/^redash:\/\/(query|dashboard)\/(\d+)$/);

    if (!match) {
      throw new Error(`Invalid resource URI: ${uri}`);
    }

    const [, type, id] = match;
    const resourceId = parseInt(id, 10);

    if (type === 'query') {
      const query = await redashClient.getQuery(resourceId);
      const result = await redashClient.executeQuery(resourceId);

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              query: query,
              result: result
            }, null, 2)
          }
        ]
      };
    } else if (type === 'dashboard') {
      const dashboard = await redashClient.getDashboard(resourceId);

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(dashboard, null, 2)
          }
        ]
      };
    }

    throw new Error(`Unsupported resource type: ${type}`);
  } catch (error) {
    console.error(`Error reading resource ${uri}:`, error);
    throw error;
  }
});

// ----- Register Tools -----
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_queries",
        description: "List all available queries in Redash",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number (starts at 1)" },
            pageSize: { type: "number", description: "Number of results per page" },
            q: { type: "string", description: "Search query" }
          }
        }
      },
      {
        name: "get_query",
        description: "Get details of a specific query",
        inputSchema: {
          type: "object",
          properties: {
            queryId: { type: "number", description: "ID of the query to get" }
          },
          required: ["queryId"]
        }
      },
      {
        name: "create_query",
        description: "Create a new query in Redash",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the query" },
            data_source_id: { type: "number", description: "ID of the data source to use" },
            query: { type: "string", description: "SQL query text" },
            description: { type: "string", description: "Description of the query" },
            options: { type: "object", description: "Query options" },
            schedule: { type: "object", description: "Query schedule" },
            tags: { type: "array", items: { type: "string" }, description: "Tags for the query" }
          },
          required: ["name", "data_source_id", "query"]
        }
      },
      {
        name: "update_query",
        description: "Update an existing query in Redash",
        inputSchema: {
          type: "object",
          properties: {
            queryId: { type: "number", description: "ID of the query to update" },
            name: { type: "string", description: "New name of the query" },
            data_source_id: { type: "number", description: "ID of the data source to use" },
            query: { type: "string", description: "SQL query text" },
            description: { type: "string", description: "Description of the query" },
            options: { type: "object", description: "Query options" },
            schedule: { type: "object", description: "Query schedule" },
            tags: { type: "array", items: { type: "string" }, description: "Tags for the query" },
            is_archived: { type: "boolean", description: "Whether the query is archived" },
            is_draft: { type: "boolean", description: "Whether the query is a draft" }
          },
          required: ["queryId"]
        }
      },
      {
        name: "archive_query",
        description: "Archive (soft-delete) a query in Redash",
        inputSchema: {
          type: "object",
          properties: {
            queryId: { type: "number", description: "ID of the query to archive" }
          },
          required: ["queryId"]
        }
      },
      {
        name: "list_data_sources",
        description: "List all available data sources in Redash",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "execute_query",
        description: "Execute a Redash query and return results",
        inputSchema: {
          type: "object",
          properties: {
            queryId: { type: "number", description: "ID of the query to execute" },
            parameters: {
              type: "object",
              description: "Parameters to pass to the query (if any)",
              additionalProperties: true
            }
          },
          required: ["queryId"]
        }
      },
      {
        name: "get_query_results_csv",
        description: "Get query results in CSV format. Returns the last cached results, or optionally refreshes the query first to get the latest data. Note: Does not support parameterized queries.",
        inputSchema: {
          type: "object",
          properties: {
            queryId: { type: "number", description: "ID of the query to get results from" },
            refresh: { type: "boolean", description: "Whether to refresh the query before fetching results to ensure latest data (default: false)" }
          },
          required: ["queryId"]
        }
      },
      {
        name: "list_dashboards",
        description: "List all available dashboards in Redash",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number (starts at 1)" },
            pageSize: { type: "number", description: "Number of results per page" }
          }
        }
      },
      {
        name: "get_dashboard",
        description: "Get details of a specific dashboard",
        inputSchema: {
          type: "object",
          properties: {
            dashboardId: { type: "number", description: "ID of the dashboard to get" }
          },
          required: ["dashboardId"]
        }
      },
      {
        name: "get_visualization",
        description: "Get details of a specific visualization",
        inputSchema: {
          type: "object",
          properties: {
            visualizationId: { type: "number", description: "ID of the visualization to get" }
          },
          required: ["visualizationId"]
        }
      },
      {
        name: "execute_adhoc_query",
        description: "Execute an ad-hoc query without saving it to Redash. Creates a temporary query that is automatically deleted after execution.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "SQL query to execute" },
            dataSourceId: { type: "number", description: "ID of the data source to query against" }
          },
          required: ["query", "dataSourceId"]
        }
      },
      {
        name: "create_visualization",
        description: "Create a new visualization for a query",
        inputSchema: {
          type: "object",
          properties: {
            query_id: { type: "number", description: "ID of the query to create visualization for" },
            type: { type: "string", description: "Type of visualization. Available types depend on your Redash instance. Use get_query to see existing visualization types in use." },
            name: { type: "string", description: "Name of the visualization" },
            description: { type: "string", description: "Description of the visualization" },
            options: { type: "object", description: "Visualization-specific configuration. The structure depends on your Redash instance and visualization type. Use get_visualization to examine existing visualizations of the same type as a reference." }
          },
          required: ["query_id", "type", "name", "options"]
        }
      },
      {
        name: "update_visualization",
        description: "Update an existing visualization",
        inputSchema: {
          type: "object",
          properties: {
            visualizationId: { type: "number", description: "ID of the visualization to update" },
            type: { type: "string", description: "Type of visualization. Available types depend on your Redash instance." },
            name: { type: "string", description: "Name of the visualization" },
            description: { type: "string", description: "Description of the visualization" },
            options: { type: "object", description: "Visualization-specific configuration. The structure depends on your Redash instance and visualization type. Use get_visualization to see the current configuration before updating." }
          },
          required: ["visualizationId"]
        }
      },
      {
        name: "delete_visualization",
        description: "Delete a visualization",
        inputSchema: {
          type: "object",
          properties: {
            visualizationId: { type: "number", description: "ID of the visualization to delete" }
          },
          required: ["visualizationId"]
        }
      },
      {
        name: "get_schema",
        description: "Get schema of a specific data source",
        inputSchema: {
          type: "object",
          properties: {
            dataSourceId: {
              type: "number",
              description: "ID of the data source to get schema",
            },
          },
          required: ["dataSourceId"],
        },
      },
      // Dashboard tools
      {
        name: "create_dashboard",
        description: "Create a new dashboard in Redash",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the dashboard" },
            tags: { type: "array", items: { type: "string" }, description: "Tags for the dashboard" }
          },
          required: ["name"]
        }
      },
      {
        name: "update_dashboard",
        description: "Update an existing dashboard in Redash",
        inputSchema: {
          type: "object",
          properties: {
            dashboardId: { type: "number", description: "ID of the dashboard to update" },
            name: { type: "string", description: "New name of the dashboard" },
            tags: { type: "array", items: { type: "string" }, description: "Tags for the dashboard" },
            is_archived: { type: "boolean", description: "Whether the dashboard is archived" },
            is_draft: { type: "boolean", description: "Whether the dashboard is a draft" },
            dashboard_filters_enabled: { type: "boolean", description: "Whether dashboard filters are enabled" }
          },
          required: ["dashboardId"]
        }
      },
      {
        name: "archive_dashboard",
        description: "Archive (soft-delete) a dashboard in Redash",
        inputSchema: {
          type: "object",
          properties: {
            dashboardId: { type: "number", description: "ID of the dashboard to archive" }
          },
          required: ["dashboardId"]
        }
      },
      {
        name: "fork_dashboard",
        description: "Fork (duplicate) an existing dashboard",
        inputSchema: {
          type: "object",
          properties: {
            dashboardId: { type: "number", description: "ID of the dashboard to fork" }
          },
          required: ["dashboardId"]
        }
      },
      {
        name: "get_public_dashboard",
        description: "Get a public dashboard by its share token",
        inputSchema: {
          type: "object",
          properties: {
            token: { type: "string", description: "Public share token of the dashboard" }
          },
          required: ["token"]
        }
      },
      {
        name: "share_dashboard",
        description: "Share a dashboard and create a public link",
        inputSchema: {
          type: "object",
          properties: {
            dashboardId: { type: "number", description: "ID of the dashboard to share" }
          },
          required: ["dashboardId"]
        }
      },
      {
        name: "unshare_dashboard",
        description: "Unshare a dashboard and revoke its public link",
        inputSchema: {
          type: "object",
          properties: {
            dashboardId: { type: "number", description: "ID of the dashboard to unshare" }
          },
          required: ["dashboardId"]
        }
      },
      {
        name: "get_my_dashboards",
        description: "Get dashboards created by the current user",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number (starts at 1)" },
            pageSize: { type: "number", description: "Number of results per page" }
          }
        }
      },
      {
        name: "get_favorite_dashboards",
        description: "Get dashboards marked as favorite by the current user",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number (starts at 1)" },
            pageSize: { type: "number", description: "Number of results per page" }
          }
        }
      },
      {
        name: "add_dashboard_favorite",
        description: "Add a dashboard to favorites",
        inputSchema: {
          type: "object",
          properties: {
            dashboardId: { type: "number", description: "ID of the dashboard to add to favorites" }
          },
          required: ["dashboardId"]
        }
      },
      {
        name: "remove_dashboard_favorite",
        description: "Remove a dashboard from favorites",
        inputSchema: {
          type: "object",
          properties: {
            dashboardId: { type: "number", description: "ID of the dashboard to remove from favorites" }
          },
          required: ["dashboardId"]
        }
      },
      {
        name: "get_dashboard_tags",
        description: "Get all tags used in dashboards",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      // Alert tools
      {
        name: "list_alerts",
        description: "List all alerts in Redash",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_alert",
        description: "Get details of a specific alert",
        inputSchema: {
          type: "object",
          properties: {
            alertId: { type: "number", description: "ID of the alert to get" }
          },
          required: ["alertId"]
        }
      },
      {
        name: "create_alert",
        description: "Create a new alert in Redash. Alerts notify you when a query result meets a specified condition.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the alert" },
            query_id: { type: "number", description: "ID of the query to monitor" },
            options: {
              type: "object",
              description: "Alert options including column to monitor, operator (e.g., 'greater than', 'less than', 'equals'), and threshold value",
              properties: {
                column: { type: "string", description: "Column name to monitor" },
                op: { type: "string", description: "Comparison operator: 'greater than', 'less than', 'equals', 'not equals', etc." },
                value: { type: ["number", "string"], description: "Threshold value to compare against" },
                custom_subject: { type: "string", description: "Custom email subject" },
                custom_body: { type: "string", description: "Custom email body" }
              },
              required: ["column", "op", "value"]
            },
            rearm: { type: ["number", "null"], description: "Number of seconds to wait before triggering again (null for never)" }
          },
          required: ["name", "query_id", "options"]
        }
      },
      {
        name: "update_alert",
        description: "Update an existing alert in Redash",
        inputSchema: {
          type: "object",
          properties: {
            alertId: { type: "number", description: "ID of the alert to update" },
            name: { type: "string", description: "New name of the alert" },
            query_id: { type: "number", description: "ID of the query to monitor" },
            options: {
              type: "object",
              description: "Alert options",
              properties: {
                column: { type: "string", description: "Column name to monitor" },
                op: { type: "string", description: "Comparison operator" },
                value: { type: ["number", "string"], description: "Threshold value" },
                custom_subject: { type: "string", description: "Custom email subject" },
                custom_body: { type: "string", description: "Custom email body" }
              }
            },
            rearm: { type: ["number", "null"], description: "Number of seconds to wait before triggering again" }
          },
          required: ["alertId"]
        }
      },
      {
        name: "delete_alert",
        description: "Delete an alert from Redash",
        inputSchema: {
          type: "object",
          properties: {
            alertId: { type: "number", description: "ID of the alert to delete" }
          },
          required: ["alertId"]
        }
      },
      {
        name: "mute_alert",
        description: "Mute an alert to temporarily stop notifications",
        inputSchema: {
          type: "object",
          properties: {
            alertId: { type: "number", description: "ID of the alert to mute" }
          },
          required: ["alertId"]
        }
      },
      {
        name: "get_alert_subscriptions",
        description: "Get all subscriptions for an alert",
        inputSchema: {
          type: "object",
          properties: {
            alertId: { type: "number", description: "ID of the alert" }
          },
          required: ["alertId"]
        }
      },
      {
        name: "add_alert_subscription",
        description: "Subscribe to an alert to receive notifications",
        inputSchema: {
          type: "object",
          properties: {
            alertId: { type: "number", description: "ID of the alert to subscribe to" },
            destination_id: { type: "number", description: "ID of the notification destination (optional, defaults to email)" }
          },
          required: ["alertId"]
        }
      },
      {
        name: "remove_alert_subscription",
        description: "Unsubscribe from an alert",
        inputSchema: {
          type: "object",
          properties: {
            alertId: { type: "number", description: "ID of the alert" },
            subscriptionId: { type: "number", description: "ID of the subscription to remove" }
          },
          required: ["alertId", "subscriptionId"]
        }
      },
      // Additional Query tools
      {
        name: "fork_query",
        description: "Fork (duplicate) an existing query",
        inputSchema: {
          type: "object",
          properties: {
            queryId: { type: "number", description: "ID of the query to fork" }
          },
          required: ["queryId"]
        }
      },
      {
        name: "get_my_queries",
        description: "Get queries created by the current user",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number (starts at 1)" },
            pageSize: { type: "number", description: "Number of results per page" }
          }
        }
      },
      {
        name: "get_recent_queries",
        description: "Get recently accessed queries",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number (starts at 1)" },
            pageSize: { type: "number", description: "Number of results per page" }
          }
        }
      },
      {
        name: "get_query_tags",
        description: "Get all tags used in queries",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_favorite_queries",
        description: "Get queries marked as favorite by the current user",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", description: "Page number (starts at 1)" },
            pageSize: { type: "number", description: "Number of results per page" }
          }
        }
      },
      {
        name: "add_query_favorite",
        description: "Add a query to favorites",
        inputSchema: {
          type: "object",
          properties: {
            queryId: { type: "number", description: "ID of the query to add to favorites" }
          },
          required: ["queryId"]
        }
      },
      {
        name: "remove_query_favorite",
        description: "Remove a query from favorites",
        inputSchema: {
          type: "object",
          properties: {
            queryId: { type: "number", description: "ID of the query to remove from favorites" }
          },
          required: ["queryId"]
        }
      },
      // Widget tools
      {
        name: "list_widgets",
        description: "List all widgets",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_widget",
        description: "Get details of a specific widget",
        inputSchema: {
          type: "object",
          properties: {
            widgetId: { type: "number", description: "ID of the widget to get" }
          },
          required: ["widgetId"]
        }
      },
      {
        name: "create_widget",
        description: "Create a new widget on a dashboard",
        inputSchema: {
          type: "object",
          properties: {
            dashboard_id: { type: "number", description: "ID of the dashboard to add the widget to" },
            visualization_id: { type: "number", description: "ID of the visualization to display (optional if text widget)" },
            text: { type: "string", description: "Text content for text widgets" },
            width: { type: "number", description: "Width of the widget (1-6)" },
            options: { type: "object", description: "Widget options" }
          },
          required: ["dashboard_id", "width"]
        }
      },
      {
        name: "update_widget",
        description: "Update an existing widget",
        inputSchema: {
          type: "object",
          properties: {
            widgetId: { type: "number", description: "ID of the widget to update" },
            visualization_id: { type: "number", description: "ID of the visualization to display" },
            text: { type: "string", description: "Text content for text widgets" },
            width: { type: "number", description: "Width of the widget (1-6)" },
            options: { type: "object", description: "Widget options" }
          },
          required: ["widgetId"]
        }
      },
      {
        name: "delete_widget",
        description: "Delete a widget from a dashboard",
        inputSchema: {
          type: "object",
          properties: {
            widgetId: { type: "number", description: "ID of the widget to delete" }
          },
          required: ["widgetId"]
        }
      },
      // Query Snippet tools
      {
        name: "list_query_snippets",
        description: "List all reusable query snippets",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_query_snippet",
        description: "Get details of a specific query snippet",
        inputSchema: {
          type: "object",
          properties: {
            snippetId: { type: "number", description: "ID of the snippet to get" }
          },
          required: ["snippetId"]
        }
      },
      {
        name: "create_query_snippet",
        description: "Create a new reusable query snippet",
        inputSchema: {
          type: "object",
          properties: {
            trigger: { type: "string", description: "Trigger keyword for the snippet" },
            description: { type: "string", description: "Description of the snippet" },
            snippet: { type: "string", description: "The SQL snippet content" }
          },
          required: ["trigger", "snippet"]
        }
      },
      {
        name: "update_query_snippet",
        description: "Update an existing query snippet",
        inputSchema: {
          type: "object",
          properties: {
            snippetId: { type: "number", description: "ID of the snippet to update" },
            trigger: { type: "string", description: "Trigger keyword for the snippet" },
            description: { type: "string", description: "Description of the snippet" },
            snippet: { type: "string", description: "The SQL snippet content" }
          },
          required: ["snippetId"]
        }
      },
      {
        name: "delete_query_snippet",
        description: "Delete a query snippet",
        inputSchema: {
          type: "object",
          properties: {
            snippetId: { type: "number", description: "ID of the snippet to delete" }
          },
          required: ["snippetId"]
        }
      },
      // Destination tools
      {
        name: "list_destinations",
        description: "List all alert notification destinations (email, Slack, etc.)",
        inputSchema: {
          type: "object",
          properties: {}
        }
      }
    ]
  };
});

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  logger.debug(`Tool request received: ${name} with args: ${JSON.stringify(args)}`);

  try {
    // First perform type checking for early validation to catch errors when the provided schema doesn't match expectations
    // This prevents confusion between similar tool names like create_query and execute_query
    if (name === "create_query") {
      try {
        logger.debug(`Validating create_query schema`);
        const validatedArgs = createQuerySchema.parse(args);
        logger.debug(`Schema validation passed for create_query: ${JSON.stringify(validatedArgs)}`);
        return await createQuery(validatedArgs);
      } catch (validationError) {
        logger.error(`Schema validation failed for create_query: ${validationError}`);
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Invalid parameters for create_query: ${validationError instanceof Error ? validationError.message : String(validationError)}`
          }]
        };
      }
    } else if (name === "update_query") {
      try {
        logger.debug(`Validating update_query schema`);
        const validatedArgs = updateQuerySchema.parse(args);
        logger.debug(`Schema validation passed for update_query: ${JSON.stringify(validatedArgs)}`);
        return await updateQuery(validatedArgs);
      } catch (validationError) {
        logger.error(`Schema validation failed for update_query: ${validationError}`);
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Invalid parameters for update_query: ${validationError instanceof Error ? validationError.message : String(validationError)}`
          }]
        };
      }
    }

    // Switch statement for other tools
    switch (name) {
      case "list_queries":
        logger.debug(`Handling list_queries`);
        return await listQueries(listQueriesSchema.parse(args));

      case "get_query":
        logger.debug(`Handling get_query`);
        return await getQuery(getQuerySchema.parse(args));

      // create_query and update_query are already handled in the if-else above

      case "archive_query":
        logger.debug(`Handling archive_query`);
        return await archiveQuery(archiveQuerySchema.parse(args));

      case "list_data_sources":
        logger.debug(`Handling list_data_sources`);
        return await listDataSources();

      case "execute_query":
        logger.debug(`Handling execute_query`);
        return await executeQuery(executeQuerySchema.parse(args));

      case "get_query_results_csv":
        logger.debug(`Handling get_query_results_csv`);
        return await getQueryResultsCsv(getQueryResultsCsvSchema.parse(args));

      case "list_dashboards":
        logger.debug(`Handling list_dashboards`);
        return await listDashboards(listDashboardsSchema.parse(args));

      case "get_dashboard":
        logger.debug(`Handling get_dashboard`);
        return await getDashboard(getDashboardSchema.parse(args));

      case "get_visualization":
        logger.debug(`Handling get_visualization`);
        return await getVisualization(getVisualizationSchema.parse(args));

      case "execute_adhoc_query":
        logger.debug(`Handling execute_adhoc_query`);
        return await executeAdhocQuery(executeAdhocQuerySchema.parse(args));

      case "create_visualization":
        return await createVisualization(createVisualizationSchema.parse(args));

      case "update_visualization":
        return await updateVisualization(updateVisualizationSchema.parse(args));

      case "delete_visualization":
        return await deleteVisualization(deleteVisualizationSchema.parse(args));

      case "get_schema":
        logger.debug(`Handling get_schema`);
        return await getSchema(getSchemaSchema.parse(args));

      // Dashboard tools
      case "create_dashboard":
        logger.debug(`Handling create_dashboard`);
        return await createDashboard(createDashboardSchema.parse(args));

      case "update_dashboard":
        logger.debug(`Handling update_dashboard`);
        return await updateDashboard(updateDashboardSchema.parse(args));

      case "archive_dashboard":
        logger.debug(`Handling archive_dashboard`);
        return await archiveDashboard(archiveDashboardSchema.parse(args));

      case "fork_dashboard":
        logger.debug(`Handling fork_dashboard`);
        return await forkDashboard(forkDashboardSchema.parse(args));

      case "get_public_dashboard":
        logger.debug(`Handling get_public_dashboard`);
        return await getPublicDashboard(getPublicDashboardSchema.parse(args));

      case "share_dashboard":
        logger.debug(`Handling share_dashboard`);
        return await shareDashboard(shareDashboardSchema.parse(args));

      case "unshare_dashboard":
        logger.debug(`Handling unshare_dashboard`);
        return await unshareDashboard(unshareDashboardSchema.parse(args));

      case "get_my_dashboards":
        logger.debug(`Handling get_my_dashboards`);
        return await getMyDashboards(getMyDashboardsSchema.parse(args));

      case "get_favorite_dashboards":
        logger.debug(`Handling get_favorite_dashboards`);
        return await getFavoriteDashboards(getFavoriteDashboardsSchema.parse(args));

      case "add_dashboard_favorite":
        logger.debug(`Handling add_dashboard_favorite`);
        return await addDashboardFavorite(addDashboardFavoriteSchema.parse(args));

      case "remove_dashboard_favorite":
        logger.debug(`Handling remove_dashboard_favorite`);
        return await removeDashboardFavorite(removeDashboardFavoriteSchema.parse(args));

      case "get_dashboard_tags":
        logger.debug(`Handling get_dashboard_tags`);
        return await getDashboardTags();

      // Alert tools
      case "list_alerts":
        logger.debug(`Handling list_alerts`);
        return await listAlerts();

      case "get_alert":
        logger.debug(`Handling get_alert`);
        return await getAlert(getAlertSchema.parse(args));

      case "create_alert":
        logger.debug(`Handling create_alert`);
        return await createAlert(createAlertSchema.parse(args));

      case "update_alert":
        logger.debug(`Handling update_alert`);
        return await updateAlert(updateAlertSchema.parse(args));

      case "delete_alert":
        logger.debug(`Handling delete_alert`);
        return await deleteAlert(deleteAlertSchema.parse(args));

      case "mute_alert":
        logger.debug(`Handling mute_alert`);
        return await muteAlert(muteAlertSchema.parse(args));

      case "get_alert_subscriptions":
        logger.debug(`Handling get_alert_subscriptions`);
        return await getAlertSubscriptions(getAlertSubscriptionsSchema.parse(args));

      case "add_alert_subscription":
        logger.debug(`Handling add_alert_subscription`);
        return await addAlertSubscription(addAlertSubscriptionSchema.parse(args));

      case "remove_alert_subscription":
        logger.debug(`Handling remove_alert_subscription`);
        return await removeAlertSubscription(removeAlertSubscriptionSchema.parse(args));

      // Additional Query tools
      case "fork_query":
        logger.debug(`Handling fork_query`);
        return await forkQuery(forkQuerySchema.parse(args));

      case "get_my_queries":
        logger.debug(`Handling get_my_queries`);
        return await getMyQueries(getMyQueriesSchema.parse(args));

      case "get_recent_queries":
        logger.debug(`Handling get_recent_queries`);
        return await getRecentQueries(getRecentQueriesSchema.parse(args));

      case "get_query_tags":
        logger.debug(`Handling get_query_tags`);
        return await getQueryTags();

      case "get_favorite_queries":
        logger.debug(`Handling get_favorite_queries`);
        return await getFavoriteQueries(getFavoriteQueriesSchema.parse(args));

      case "add_query_favorite":
        logger.debug(`Handling add_query_favorite`);
        return await addQueryFavorite(addQueryFavoriteSchema.parse(args));

      case "remove_query_favorite":
        logger.debug(`Handling remove_query_favorite`);
        return await removeQueryFavorite(removeQueryFavoriteSchema.parse(args));

      // Widget tools
      case "list_widgets":
        logger.debug(`Handling list_widgets`);
        return await listWidgets();

      case "get_widget":
        logger.debug(`Handling get_widget`);
        return await getWidget(getWidgetSchema.parse(args));

      case "create_widget":
        logger.debug(`Handling create_widget`);
        return await createWidget(createWidgetSchema.parse(args));

      case "update_widget":
        logger.debug(`Handling update_widget`);
        return await updateWidget(updateWidgetSchema.parse(args));

      case "delete_widget":
        logger.debug(`Handling delete_widget`);
        return await deleteWidget(deleteWidgetSchema.parse(args));

      // Query Snippet tools
      case "list_query_snippets":
        logger.debug(`Handling list_query_snippets`);
        return await listQuerySnippets();

      case "get_query_snippet":
        logger.debug(`Handling get_query_snippet`);
        return await getQuerySnippet(getQuerySnippetSchema.parse(args));

      case "create_query_snippet":
        logger.debug(`Handling create_query_snippet`);
        return await createQuerySnippet(createQuerySnippetSchema.parse(args));

      case "update_query_snippet":
        logger.debug(`Handling update_query_snippet`);
        return await updateQuerySnippet(updateQuerySnippetSchema.parse(args));

      case "delete_query_snippet":
        logger.debug(`Handling delete_query_snippet`);
        return await deleteQuerySnippet(deleteQuerySnippetSchema.parse(args));

      // Destination tools
      case "list_destinations":
        logger.debug(`Handling list_destinations`);
        return await listDestinations();

      default:
        logger.error(`Unknown tool requested: ${name}`);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`
            }
          ]
        };
    }
  } catch (error) {
    logger.error(`Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof z.ZodError) {
      logger.error(`Validation error details: ${JSON.stringify(error.errors)}`);
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
});

// Start the server with stdio transport
async function main() {
  try {
    const transport = new StdioServerTransport();

    logger.info("Starting Redash MCP server...");
    await server.connect(transport);
    logger.setServer(server);
    logger.info("Redash MCP server connected!");
  } catch (error) {
    logger.error(`Failed to start server: ${error}`);
    process.exit(1);
  }
}

main();
