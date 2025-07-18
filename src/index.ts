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
import { redashClient, CreateQueryRequest, UpdateQueryRequest, CreateVisualizationRequest, UpdateVisualizationRequest } from "./redashClient.js";
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
