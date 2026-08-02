#!/usr/bin/env node

import {
  McpServer,
  ResourceTemplate,
  type CallToolResult,
  type Variables,
} from "@modelcontextprotocol/server";
import { serveStdio, type ServeStdioOptions, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { z, type ZodObject, type ZodRawShape } from "zod";
import * as dotenv from 'dotenv';
import { getRedashClient, CreateQueryRequest, UpdateQueryRequest, CreateVisualizationRequest, UpdateVisualizationRequest, CreateDashboardRequest, UpdateDashboardRequest, CreateAlertRequest, UpdateAlertRequest, CreateAlertSubscriptionRequest, CreateWidgetRequest, UpdateWidgetRequest, CreateQuerySnippetRequest, UpdateQuerySnippetRequest } from "./redashClient.js";
import { buildChartVisualizationOptions, chartVisualizationUpdateSchema } from "./chartVisualization.js";
import { mergeNamedEntries, queryParameterPatchSchema, resolveParameterOrder, toNamedEntries, toNamedRecord, widgetParameterMappingPatchSchema } from "./parameterManagement.js";
import { buildParameterizedExecutionParameters, ParameterizedExecutionError } from "./parameterizedExecution.js";
import { mergeDeep } from "./utils.js";
import { buildWidgetLayoutOptions, dashboardGridDefaults, summarizeWidgetLayout, widgetLayoutEntrySchema, widgetPositionSchema } from "./widgetLayout.js";
import { logger } from "./logger.js";

// Load environment variables
dotenv.config({ quiet: true });

const emptyInputSchema = z.object({});

interface JsonSchemaConverter {
  input: (options: { target: string }) => Record<string, unknown>;
  output: (options: { target: string }) => Record<string, unknown>;
}

// The stateless HTTP transport builds a fresh McpServer per request, and
// registerTool eagerly converts each input schema to JSON Schema. The schemas
// are immutable module-level constants, so memoize the conversion per schema.
function cacheJsonSchemaConversion<T extends ZodRawShape>(schema: ZodObject<T>): ZodObject<T> {
  const std = schema["~standard"] as { jsonSchema?: JsonSchemaConverter };
  const converter = std.jsonSchema;
  if (!converter) {
    return schema;
  }

  const cachedByTarget = new Map<string, Record<string, unknown>>();
  std.jsonSchema = {
    input: (options) => {
      let converted = cachedByTarget.get(options.target);
      if (!converted) {
        converted = converter.input(options);
        cachedByTarget.set(options.target, converted);
      }
      return converted;
    },
    output: (options) => converter.output(options),
  };

  return schema;
}

function defineTool<T extends ZodRawShape>(
  name: string,
  description: string,
  handler: (args: z.output<ZodObject<T>>) => Promise<unknown>,
  schema: ZodObject<T> = emptyInputSchema as ZodObject<T>,
) {
  return {
    name,
    description,
    inputSchema: cacheJsonSchemaConversion(schema),
    handler: handler as (args: Record<string, unknown>) => Promise<unknown>,
  };
}

const paginationPageField = z.coerce.number().optional().default(1).describe("Page number (starts at 1)");
const paginationPageSizeField = z.coerce.number().optional().default(25).describe("Number of results per page");

// ----- Tools Implementation -----

// Tool: get_query
const getQuerySchema = z.object({
  queryId: z.coerce.number().describe("ID of the query to get")
});

async function getQuery(params: z.infer<typeof getQuerySchema>) {
  try {
    const { queryId } = params;
    const query = await getRedashClient().getQuery(queryId);

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
  name: z.string().describe("Name of the query"),
  data_source_id: z.coerce.number().describe("ID of the data source to use"),
  query: z.string().describe("SQL query text"),
  description: z.string().optional().describe("Description of the query"),
  options: z.record(z.string(), z.any()).optional().describe("Query options"),
  schedule: z.record(z.string(), z.any()).optional().describe("Query schedule"),
  tags: z.array(z.string()).optional().describe("Tags for the query")
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
    const result = await getRedashClient().createQuery(queryData);
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
  queryId: z.coerce.number().describe("ID of the query to update"),
  name: z.string().optional().describe("New name of the query"),
  data_source_id: z.coerce.number().optional().describe("ID of the data source to use"),
  query: z.string().optional().describe("SQL query text"),
  description: z.string().optional().describe("Description of the query"),
  options: z.record(z.string(), z.any()).optional().describe("Query options"),
  schedule: z.record(z.string(), z.any()).optional().describe("Query schedule"),
  tags: z.array(z.string()).optional().describe("Tags for the query"),
  is_archived: z.boolean().optional().describe("Whether the query is archived"),
  is_draft: z.boolean().optional().describe("Whether the query is a draft")
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
    const result = await getRedashClient().updateQuery(queryId, queryData);
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

// Tool: get_query_parameters
const getQueryParametersSchema = z.object({
  queryId: z.coerce.number().describe("ID of the query")
});

async function getQueryParameters(params: z.infer<typeof getQueryParametersSchema>) {
  try {
    const query = await getRedashClient().getQuery(params.queryId);
    const queryOptions = query.options || {};

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              queryId: query.id,
              name: query.name,
              parameters: Array.isArray(queryOptions.parameters) ? queryOptions.parameters : []
            },
            null,
            2
          )
        }
      ]
    };
  } catch (error) {
    logger.error(`Error getting query parameters for ${params.queryId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting query parameters for ${params.queryId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: update_query_parameters
const updateQueryParametersSchema = z.object({
  queryId: z.coerce.number().describe("ID of the query"),
  parameters: z.array(queryParameterPatchSchema).default([]).describe("Parameter definitions to merge into the query"),
  removeParameterNames: z.array(z.string()).optional().describe("Saved parameter names to remove from the query"),
  replaceParameters: z.boolean().optional().describe("Replace the stored parameter list instead of merging")
});

async function updateQueryParameters(params: z.infer<typeof updateQueryParametersSchema>) {
  try {
    const query = await getRedashClient().getQuery(params.queryId);
    const queryOptions = query.options || {};
    const existingParameters = Array.isArray(queryOptions.parameters) ? queryOptions.parameters : [];
    const updatedParameters = mergeNamedEntries(existingParameters, params.parameters, {
      replace: params.replaceParameters,
      removeNames: params.removeParameterNames
    });

    const updateData: UpdateQueryRequest = {
      options: mergeDeep(queryOptions, {
        parameters: updatedParameters
      })
    };

    const result = await getRedashClient().updateQuery(params.queryId, updateData);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error updating query parameters for ${params.queryId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error updating query parameters for ${params.queryId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: archive_query
const archiveQuerySchema = z.object({
  queryId: z.coerce.number().describe("ID of the query to archive")
});

async function archiveQuery(params: z.infer<typeof archiveQuerySchema>) {
  try {
    const { queryId } = params;
    const result = await getRedashClient().archiveQuery(queryId);

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
    const dataSources = await getRedashClient().getDataSources();

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
  page: paginationPageField,
  pageSize: paginationPageSizeField,
  q: z.string().optional().describe("Search query")
});

async function listQueries(params: z.infer<typeof listQueriesSchema>) {
  try {
    const { page, pageSize, q } = params;
    const queries = await getRedashClient().getQueries(page, pageSize, q);

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
  queryId: z.coerce.number().describe("ID of the query to execute"),
  parameters: z.record(z.string(), z.any()).optional().describe("Parameters to pass to the query (if any)"),
  maxAge: z.coerce.number().optional().describe("Cache age in seconds. Use 0 to force a fresh execution.")
});

async function executeQuery(params: z.infer<typeof executeQuerySchema>) {
  try {
    const { queryId, parameters, maxAge } = params;
    const result = await getRedashClient().executeQuery(queryId, parameters, maxAge);

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

// Tool: execute_parameterized_query
const executeParameterizedQuerySchema = z.object({
  queryId: z.coerce.number().describe("ID of the query to execute"),
  parameters: z.record(z.string(), z.any()).optional().default({}).describe("Explicit parameter values to coerce using the saved Redash parameter definitions"),
  useSavedDefaults: z.boolean().optional().default(true).describe("Apply saved default parameter values when a parameter is omitted"),
  maxAge: z.coerce.number().optional().describe("Cache age in seconds. Use 0 to force a fresh execution.")
});

async function executeParameterizedQuery(params: z.infer<typeof executeParameterizedQuerySchema>) {
  let effectiveParameters: Record<string, unknown> | undefined;

  try {
    const query = await getRedashClient().getQuery(params.queryId);
    const parameterDefinitions = Array.isArray(query.options?.parameters) ? query.options.parameters : [];
    effectiveParameters = buildParameterizedExecutionParameters(parameterDefinitions, params.parameters, {
      useSavedDefaults: params.useSavedDefaults
    });
    const result = await getRedashClient().executeQuery(params.queryId, effectiveParameters, params.maxAge);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            queryId: query.id,
            name: query.name,
            effectiveParameters,
            result
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const details = {
      queryId: params.queryId,
      effectiveParameters,
      error: errorMessage
    };

    if (error instanceof ParameterizedExecutionError) {
      logger.error(`Error normalizing parameterized query ${params.queryId}: ${error}`);
    } else {
      logger.error(`Error executing parameterized query ${params.queryId}: ${error}`);
    }

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(details, null, 2)
        }
      ]
    };
  }
}

// Tool: get_query_results_csv
const getQueryResultsCsvSchema = z.object({
  queryId: z.coerce.number().describe("ID of the query to get results from"),
  refresh: z.boolean().optional().default(false).describe("Whether to refresh the query before fetching results to ensure latest data (default: false)")
});

async function getQueryResultsCsv(params: z.infer<typeof getQueryResultsCsvSchema>) {
  try {
    const { queryId, refresh } = params;
    const csv = await getRedashClient().getQueryResultsAsCsv(queryId, refresh);

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
  page: paginationPageField,
  pageSize: paginationPageSizeField
});

async function listDashboards(params: z.infer<typeof listDashboardsSchema>) {
  try {
    const { page, pageSize } = params;
    const dashboards = await getRedashClient().getDashboards(page, pageSize);

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
  dashboardId: z.coerce.number().describe("ID of the dashboard to get")
});

async function getDashboard(params: z.infer<typeof getDashboardSchema>) {
  try {
    const { dashboardId } = params;
    const dashboard = await getRedashClient().getDashboard(dashboardId);

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

// Tool: get_dashboard_layout
const getDashboardLayoutSchema = z.object({
  dashboardId: z.coerce.number().describe("ID of the dashboard")
});

async function getDashboardLayout(params: z.infer<typeof getDashboardLayoutSchema>) {
  try {
    const dashboard = await getRedashClient().getDashboard(params.dashboardId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            dashboardId: dashboard.id,
            name: dashboard.name,
            grid: dashboardGridDefaults,
            widgets: Array.isArray(dashboard.widgets) ? dashboard.widgets.map(summarizeWidgetLayout) : []
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error getting dashboard layout ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting dashboard layout ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: get_dashboard_by_slug
const getDashboardBySlugSchema = z.object({
  slug: z.string().describe("Slug of the dashboard to get")
});

async function getDashboardBySlug(params: z.infer<typeof getDashboardBySlugSchema>) {
  try {
    const { slug } = params;
    const dashboard = await getRedashClient().getDashboardBySlug(slug);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(dashboard, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error getting dashboard by slug '${params.slug}': ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting dashboard by slug '${params.slug}': ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: get_visualization
const getVisualizationSchema = z.object({
  visualizationId: z.coerce.number().describe("ID of the visualization to get")
});

async function getVisualization(params: z.infer<typeof getVisualizationSchema>) {
  try {
    const { visualizationId } = params;
    const visualization = await getRedashClient().getVisualization(visualizationId);

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
  query: z.string().describe("SQL query to execute"),
  dataSourceId: z.coerce.number().describe("ID of the data source to query against"),
  applyAutoLimit: z.boolean().optional().default(true).describe("Whether Redash should apply an automatic LIMIT. Set to false for MSSQL data sources, where LIMIT is invalid T-SQL.")
});

async function executeAdhocQuery(params: z.infer<typeof executeAdhocQuerySchema>) {
  try {
    const { query, dataSourceId, applyAutoLimit } = params;
    const result = await getRedashClient().executeAdhocQuery(query, dataSourceId, applyAutoLimit);

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
  query_id: z.coerce.number().describe("ID of the query to create visualization for"),
  type: z.string().describe("Type of visualization. Available types depend on your Redash instance. Use get_query to see existing visualization types in use."),
  name: z.string().describe("Name of the visualization"),
  description: z.string().optional().describe("Description of the visualization"),
  options: z.record(z.string(), z.any()).describe("Visualization-specific configuration. The structure depends on your Redash instance and visualization type. Use get_visualization to examine existing visualizations of the same type as a reference.")
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

    const result = await getRedashClient().createVisualization(visualizationData);

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
  visualizationId: z.coerce.number().describe("ID of the visualization to update"),
  type: z.string().optional().describe("Type of visualization. Available types depend on your Redash instance."),
  name: z.string().optional().describe("Name of the visualization"),
  description: z.string().optional().describe("Description of the visualization"),
  options: z.record(z.string(), z.any()).optional().describe("Visualization-specific configuration. The structure depends on your Redash instance and visualization type. Use get_visualization to see the current configuration before updating.")
});

async function updateVisualization(params: z.infer<typeof updateVisualizationSchema>) {
  try {
    const { visualizationId, ...updateData } = params;
    const result = await getRedashClient().updateVisualization(visualizationId, updateData);

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

// Tool: update_chart_visualization
async function updateChartVisualization(params: z.infer<typeof chartVisualizationUpdateSchema>) {
  try {
    const { visualizationId, replaceOptions, chartOptions: _chartOptions, ...metadata } = params;
    const currentVisualization = replaceOptions ? null : await getRedashClient().getVisualization(visualizationId);
    const options = buildChartVisualizationOptions(params, (currentVisualization?.options ?? {}) as Record<string, unknown>);

    const result = await getRedashClient().updateVisualization(visualizationId, {
      ...metadata,
      options,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error updating chart visualization ${params.visualizationId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error updating chart visualization ${params.visualizationId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: delete_visualization
const deleteVisualizationSchema = z.object({
  visualizationId: z.coerce.number().describe("ID of the visualization to delete")
});

async function deleteVisualization(params: z.infer<typeof deleteVisualizationSchema>) {
  try {
    const { visualizationId } = params;
    await getRedashClient().deleteVisualization(visualizationId);

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
  dataSourceId: z.coerce.number().describe("ID of the data source to get schema"),
});

async function getSchema(params: z.infer<typeof getSchemaSchema>) {
  try {
    const { dataSourceId } = params;
    const query = await getRedashClient().getSchema(dataSourceId);

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
  name: z.string().describe("Name of the dashboard"),
  tags: z.array(z.string()).optional().describe("Tags for the dashboard")
});

async function createDashboard(params: z.infer<typeof createDashboardSchema>) {
  try {
    const dashboardData: CreateDashboardRequest = {
      name: params.name,
      tags: params.tags || []
    };
    const result = await getRedashClient().createDashboard(dashboardData);
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
  dashboardId: z.coerce.number().describe("ID of the dashboard to update"),
  name: z.string().optional().describe("New name of the dashboard"),
  tags: z.array(z.string()).optional().describe("Tags for the dashboard"),
  is_archived: z.boolean().optional().describe("Whether the dashboard is archived"),
  is_draft: z.boolean().optional().describe("Whether the dashboard is a draft"),
  dashboard_filters_enabled: z.boolean().optional().describe("Whether dashboard filters are enabled")
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

    const result = await getRedashClient().updateDashboard(dashboardId, dashboardData);
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

// Tool: get_dashboard_parameters
const getDashboardParametersSchema = z.object({
  dashboardId: z.coerce.number().describe("ID of the dashboard")
});

async function getDashboardParameters(params: z.infer<typeof getDashboardParametersSchema>) {
  try {
    const dashboard = await getRedashClient().getDashboard(params.dashboardId);
    const dashboardOptions = dashboard.options || {};

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              dashboardId: dashboard.id,
              name: dashboard.name,
              dashboard_filters_enabled: dashboard.dashboard_filters_enabled,
              globalParamOrder: Array.isArray(dashboardOptions.globalParamOrder) ? dashboardOptions.globalParamOrder : [],
              parameters: Array.isArray(dashboardOptions.parameters) ? dashboardOptions.parameters : [],
              widgets: Array.isArray(dashboard.widgets)
                ? dashboard.widgets.map((widget) => ({
                    widgetId: widget.id,
                    visualization_id: widget.visualization_id,
                    text: widget.text,
                    parameterMappings: toNamedEntries(widget.options?.parameterMappings || {}).sort((a, b) =>
                      a.name.localeCompare(b.name)
                    )
                  }))
                : []
            },
            null,
            2
          )
        }
      ]
    };
  } catch (error) {
    logger.error(`Error getting dashboard parameters for ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting dashboard parameters for ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: update_dashboard_parameters
const updateDashboardParametersSchema = z.object({
  dashboardId: z.coerce.number().describe("ID of the dashboard"),
  parameters: z.array(queryParameterPatchSchema).default([]).describe("Dashboard parameter values to merge into the dashboard"),
  removeParameterNames: z.array(z.string()).optional().describe("Dashboard parameter names to remove from the dashboard"),
  replaceParameters: z.boolean().optional().describe("Replace the stored parameter list instead of merging"),
  globalParamOrder: z.array(z.string()).optional().describe("Explicit display order for dashboard parameters")
});

async function updateDashboardParameters(params: z.infer<typeof updateDashboardParametersSchema>) {
  try {
    const dashboard = await getRedashClient().getDashboard(params.dashboardId);
    const dashboardOptions = dashboard.options || {};
    const existingParameters = Array.isArray(dashboardOptions.parameters) ? dashboardOptions.parameters : [];
    const updatedParameters = mergeNamedEntries(existingParameters, params.parameters, {
      replace: params.replaceParameters,
      removeNames: params.removeParameterNames
    });
    const finalOrder = resolveParameterOrder(dashboardOptions.globalParamOrder, updatedParameters.map((param) => param.name), {
      replace: params.replaceParameters,
      explicitOrder: params.globalParamOrder
    });

    const updateData: UpdateDashboardRequest = {
      options: mergeDeep(dashboardOptions, {
        parameters: updatedParameters,
        globalParamOrder: finalOrder
      })
    };

    const result = await getRedashClient().updateDashboard(params.dashboardId, updateData);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error updating dashboard parameters for ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error updating dashboard parameters for ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: archive_dashboard
const archiveDashboardSchema = z.object({
  dashboardId: z.coerce.number().describe("ID of the dashboard to archive")
});

async function archiveDashboard(params: z.infer<typeof archiveDashboardSchema>) {
  try {
    const result = await getRedashClient().archiveDashboard(params.dashboardId);
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
  dashboardId: z.coerce.number().describe("ID of the dashboard to fork")
});

async function forkDashboard(params: z.infer<typeof forkDashboardSchema>) {
  try {
    const result = await getRedashClient().forkDashboard(params.dashboardId);
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
  token: z.string().describe("Public share token of the dashboard")
});

async function getPublicDashboard(params: z.infer<typeof getPublicDashboardSchema>) {
  try {
    const result = await getRedashClient().getPublicDashboard(params.token);
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
  dashboardId: z.coerce.number().describe("ID of the dashboard to share")
});

async function shareDashboard(params: z.infer<typeof shareDashboardSchema>) {
  try {
    const result = await getRedashClient().shareDashboard(params.dashboardId);
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
  dashboardId: z.coerce.number().describe("ID of the dashboard to unshare")
});

async function unshareDashboard(params: z.infer<typeof unshareDashboardSchema>) {
  try {
    const result = await getRedashClient().unshareDashboard(params.dashboardId);
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
  page: paginationPageField,
  pageSize: paginationPageSizeField
});

async function getMyDashboards(params: z.infer<typeof getMyDashboardsSchema>) {
  try {
    const result = await getRedashClient().getMyDashboards(params.page, params.pageSize);
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
  page: paginationPageField,
  pageSize: paginationPageSizeField
});

async function getFavoriteDashboards(params: z.infer<typeof getFavoriteDashboardsSchema>) {
  try {
    const result = await getRedashClient().getFavoriteDashboards(params.page, params.pageSize);
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
  dashboardId: z.coerce.number().describe("ID of the dashboard to add to favorites")
});

async function addDashboardFavorite(params: z.infer<typeof addDashboardFavoriteSchema>) {
  try {
    const result = await getRedashClient().addDashboardFavorite(params.dashboardId);
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
  dashboardId: z.coerce.number().describe("ID of the dashboard to remove from favorites")
});

async function removeDashboardFavorite(params: z.infer<typeof removeDashboardFavoriteSchema>) {
  try {
    const result = await getRedashClient().removeDashboardFavorite(params.dashboardId);
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
    const result = await getRedashClient().getDashboardTags();
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
    const result = await getRedashClient().getAlerts();
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
  alertId: z.coerce.number().describe("ID of the alert to get")
});

async function getAlert(params: z.infer<typeof getAlertSchema>) {
  try {
    const result = await getRedashClient().getAlert(params.alertId);
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
  name: z.string().describe("Name of the alert"),
  query_id: z.coerce.number().describe("ID of the query to monitor"),
  options: z.object({
    column: z.string().describe("Column name to monitor"),
    op: z.string().describe("Comparison operator: greater than, less than, equals, not equals, etc."),
    value: z.union([z.coerce.number(), z.string()]).describe("Threshold value to compare against"),
    custom_subject: z.string().optional().describe("Custom email subject"),
    custom_body: z.string().optional().describe("Custom email body")
  }).describe("Alert options including column to monitor, operator, and threshold value"),
  rearm: z.coerce.number().nullable().optional().describe("Number of seconds to wait before triggering again (null for never)")
});

async function createAlert(params: z.infer<typeof createAlertSchema>) {
  try {
    const alertData: CreateAlertRequest = {
      name: params.name,
      query_id: params.query_id,
      options: params.options,
      rearm: params.rearm
    };
    const result = await getRedashClient().createAlert(alertData);
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
  alertId: z.coerce.number().describe("ID of the alert to update"),
  name: z.string().optional().describe("New name of the alert"),
  query_id: z.coerce.number().optional().describe("ID of the query to monitor"),
  options: z.object({
    column: z.string().optional().describe("Column name to monitor"),
    op: z.string().optional().describe("Comparison operator"),
    value: z.union([z.coerce.number(), z.string()]).optional().describe("Threshold value"),
    custom_subject: z.string().optional().describe("Custom email subject"),
    custom_body: z.string().optional().describe("Custom email body")
  }).optional().describe("Alert options"),
  rearm: z.coerce.number().nullable().optional().describe("Number of seconds to wait before triggering again")
});

async function updateAlert(params: z.infer<typeof updateAlertSchema>) {
  try {
    const { alertId, ...updateData } = params;
    const alertData: UpdateAlertRequest = {};
    if (updateData.name !== undefined) alertData.name = updateData.name;
    if (updateData.query_id !== undefined) alertData.query_id = updateData.query_id;
    if (updateData.options !== undefined) alertData.options = updateData.options;
    if (updateData.rearm !== undefined) alertData.rearm = updateData.rearm;

    const result = await getRedashClient().updateAlert(alertId, alertData);
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
  alertId: z.coerce.number().describe("ID of the alert to delete")
});

async function deleteAlert(params: z.infer<typeof deleteAlertSchema>) {
  try {
    const result = await getRedashClient().deleteAlert(params.alertId);
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
  alertId: z.coerce.number().describe("ID of the alert to mute")
});

async function muteAlert(params: z.infer<typeof muteAlertSchema>) {
  try {
    const result = await getRedashClient().muteAlert(params.alertId);
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
  alertId: z.coerce.number().describe("ID of the alert")
});

async function getAlertSubscriptions(params: z.infer<typeof getAlertSubscriptionsSchema>) {
  try {
    const result = await getRedashClient().getAlertSubscriptions(params.alertId);
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
  alertId: z.coerce.number().describe("ID of the alert to subscribe to"),
  destination_id: z.coerce.number().optional().describe("ID of the notification destination (optional, defaults to email)")
});

async function addAlertSubscription(params: z.infer<typeof addAlertSubscriptionSchema>) {
  try {
    const subscriptionData: CreateAlertSubscriptionRequest = {};
    if (params.destination_id !== undefined) subscriptionData.destination_id = params.destination_id;

    const result = await getRedashClient().addAlertSubscription(params.alertId, subscriptionData);
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
  alertId: z.coerce.number().describe("ID of the alert"),
  subscriptionId: z.coerce.number().describe("ID of the subscription to remove")
});

async function removeAlertSubscription(params: z.infer<typeof removeAlertSubscriptionSchema>) {
  try {
    const result = await getRedashClient().removeAlertSubscription(params.alertId, params.subscriptionId);
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
  queryId: z.coerce.number().describe("ID of the query to fork")
});

async function forkQuery(params: z.infer<typeof forkQuerySchema>) {
  try {
    const result = await getRedashClient().forkQuery(params.queryId);
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
  page: paginationPageField,
  pageSize: paginationPageSizeField
});

async function getMyQueries(params: z.infer<typeof getMyQueriesSchema>) {
  try {
    const result = await getRedashClient().getMyQueries(params.page, params.pageSize);
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
  page: paginationPageField,
  pageSize: paginationPageSizeField
});

async function getRecentQueries(params: z.infer<typeof getRecentQueriesSchema>) {
  try {
    const result = await getRedashClient().getRecentQueries(params.page, params.pageSize);
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
    const result = await getRedashClient().getQueryTags();
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
  page: paginationPageField,
  pageSize: paginationPageSizeField
});

async function getFavoriteQueries(params: z.infer<typeof getFavoriteQueriesSchema>) {
  try {
    const result = await getRedashClient().getFavoriteQueries(params.page, params.pageSize);
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
  queryId: z.coerce.number().describe("ID of the query to add to favorites")
});

async function addQueryFavorite(params: z.infer<typeof addQueryFavoriteSchema>) {
  try {
    const result = await getRedashClient().addQueryFavorite(params.queryId);
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
  queryId: z.coerce.number().describe("ID of the query to remove from favorites")
});

async function removeQueryFavorite(params: z.infer<typeof removeQueryFavoriteSchema>) {
  try {
    const result = await getRedashClient().removeQueryFavorite(params.queryId);
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
    const result = await getRedashClient().getWidgets();
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
  widgetId: z.coerce.number().describe("ID of the widget to get")
});

async function getWidget(params: z.infer<typeof getWidgetSchema>) {
  try {
    const result = await getRedashClient().getWidget(params.widgetId);
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
  dashboard_id: z.coerce.number().describe("ID of the dashboard to add the widget to"),
  visualization_id: z.coerce.number().optional().describe("ID of the visualization to display (optional if text widget)"),
  text: z.string().optional().describe("Text content for text widgets"),
  width: z.coerce.number().describe("Width of the widget (1-6)"),
  options: z.record(z.string(), z.any()).optional().describe("Widget options"),
  position: widgetPositionSchema.optional()
});

async function createWidget(params: z.infer<typeof createWidgetSchema>) {
  try {
    const widgetOptions = params.position ? buildWidgetLayoutOptions(params.options || {}, params.position) : (params.options || {});
    const widgetData: CreateWidgetRequest = {
      dashboard_id: params.dashboard_id,
      visualization_id: params.visualization_id,
      text: params.text,
      width: params.width,
      options: widgetOptions
    };
    const result = await getRedashClient().createWidget(widgetData);
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
  widgetId: z.coerce.number().describe("ID of the widget to update"),
  visualization_id: z.coerce.number().optional().describe("ID of the visualization to display"),
  text: z.string().optional().describe("Text content for text widgets"),
  width: z.coerce.number().optional().describe("Width of the widget (1-6)"),
  options: z.record(z.string(), z.any()).optional().describe("Widget options"),
  position: widgetPositionSchema.optional()
});

async function updateWidget(params: z.infer<typeof updateWidgetSchema>) {
  try {
    const { widgetId, position, ...updateData } = params;
    const widgetData: UpdateWidgetRequest = {};
    if (updateData.visualization_id !== undefined) widgetData.visualization_id = updateData.visualization_id;
    if (updateData.text !== undefined) widgetData.text = updateData.text;
    if (updateData.width !== undefined) widgetData.width = updateData.width;
    if (updateData.options !== undefined) widgetData.options = updateData.options;

    if (position) {
      const currentWidget = await getRedashClient().getWidget(widgetId);
      const currentOptions = updateData.options !== undefined ? updateData.options : (currentWidget.options ?? {});
      widgetData.options = buildWidgetLayoutOptions(currentOptions, position);
      if (updateData.text === undefined) {
        widgetData.text = currentWidget.text ?? "";
      }
    }

    const result = await getRedashClient().updateWidget(widgetId, widgetData);
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

// Tool: update_widget_layout
const updateWidgetLayoutSchema = z.object({
  widgetId: z.coerce.number().describe("ID of the widget"),
  position: widgetPositionSchema,
});

async function updateWidgetLayout(params: z.infer<typeof updateWidgetLayoutSchema>) {
  try {
    const widget = await getRedashClient().getWidget(params.widgetId);
    const result = await getRedashClient().updateWidget(params.widgetId, {
      text: widget.text ?? "",
      options: buildWidgetLayoutOptions(widget.options ?? {}, params.position),
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  } catch (error) {
    logger.error(`Error updating widget layout ${params.widgetId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error updating widget layout ${params.widgetId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: update_dashboard_layout
const updateDashboardLayoutSchema = z.object({
  dashboardId: z.coerce.number().describe("ID of the dashboard"),
  widgets: z.array(widgetLayoutEntrySchema).min(1).describe("Widgets to move or resize")
});

async function updateDashboardLayout(params: z.infer<typeof updateDashboardLayoutSchema>) {
  try {
    const dashboard = await getRedashClient().getDashboard(params.dashboardId);
    const dashboardWidgets = new Map((dashboard.widgets || []).map((widget) => [widget.id, widget]));

    for (const layout of params.widgets) {
      if (!dashboardWidgets.has(layout.widgetId)) {
        throw new Error(`Widget ${layout.widgetId} does not belong to dashboard ${params.dashboardId}`);
      }
    }

    const results = await Promise.allSettled(params.widgets.map(async (layout) => {
      const widget = dashboardWidgets.get(layout.widgetId)!;
      return getRedashClient().updateWidget(layout.widgetId, {
        text: widget.text ?? "",
        options: buildWidgetLayoutOptions(widget.options ?? {}, layout.position),
      });
    }));

    const widgetResults = results.map((result, index) => {
      const { widgetId } = params.widgets[index];
      if (result.status === "fulfilled") {
        return {
          widgetId,
          success: true,
          widget: summarizeWidgetLayout(result.value)
        };
      }

      return {
        widgetId,
        success: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      };
    });

    return {
      isError: widgetResults.some((result) => !result.success),
      content: [
        {
          type: "text",
          text: JSON.stringify({
            dashboardId: dashboard.id,
            widgetResults
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error updating dashboard layout ${params.dashboardId}: ${error}`);
    return {
      isError: true,
      content: [{ type: "text", text: `Error updating dashboard layout ${params.dashboardId}: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}

// Tool: get_widget_parameter_mappings
const getWidgetParameterMappingsSchema = z.object({
  widgetId: z.coerce.number().describe("ID of the widget")
});

async function getWidgetParameterMappings(params: z.infer<typeof getWidgetParameterMappingsSchema>) {
  try {
    const widget = await getRedashClient().getWidget(params.widgetId);
    const mappings = toNamedEntries(widget.options?.parameterMappings || {}).sort((a, b) => a.name.localeCompare(b.name));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              widgetId: widget.id,
              dashboard_id: widget.dashboard_id,
              visualization_id: widget.visualization_id,
              text: widget.text,
              parameterMappings: mappings
            },
            null,
            2
          )
        }
      ]
    };
  } catch (error) {
    logger.error(`Error getting widget parameter mappings for ${params.widgetId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error getting widget parameter mappings for ${params.widgetId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: update_widget_parameter_mappings
const updateWidgetParameterMappingsSchema = z.object({
  widgetId: z.coerce.number().describe("ID of the widget"),
  parameterMappings: z.array(widgetParameterMappingPatchSchema).default([]).describe("Parameter mappings to merge into the widget"),
  removeParameterNames: z.array(z.string()).optional().describe("Widget parameter mapping names to remove"),
  replaceParameterMappings: z.boolean().optional().describe("Replace the stored mappings instead of merging")
});

async function updateWidgetParameterMappings(params: z.infer<typeof updateWidgetParameterMappingsSchema>) {
  try {
    const widget = await getRedashClient().getWidget(params.widgetId);
    const widgetOptions = widget.options || {};
    const existingMappings = toNamedEntries(widgetOptions.parameterMappings || {});
    const updatedMappings = mergeNamedEntries(existingMappings, params.parameterMappings, {
      replace: params.replaceParameterMappings,
      removeNames: params.removeParameterNames
    });

    const updateData: UpdateWidgetRequest = {
      text: widget.text ?? "",
      options: {
        ...widgetOptions,
        parameterMappings: toNamedRecord(updatedMappings)
      }
    };

    const result = await getRedashClient().updateWidget(params.widgetId, updateData);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error updating widget parameter mappings for ${params.widgetId}: ${error}`);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error updating widget parameter mappings for ${params.widgetId}: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }
}

// Tool: delete_widget
const deleteWidgetSchema = z.object({
  widgetId: z.coerce.number().describe("ID of the widget to delete")
});

async function deleteWidget(params: z.infer<typeof deleteWidgetSchema>) {
  try {
    const result = await getRedashClient().deleteWidget(params.widgetId);
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
    const result = await getRedashClient().getQuerySnippets();
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
  snippetId: z.coerce.number().describe("ID of the snippet to get")
});

async function getQuerySnippet(params: z.infer<typeof getQuerySnippetSchema>) {
  try {
    const result = await getRedashClient().getQuerySnippet(params.snippetId);
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
  trigger: z.string().describe("Trigger keyword for the snippet"),
  description: z.string().optional().describe("Description of the snippet"),
  snippet: z.string().describe("The SQL snippet content")
});

async function createQuerySnippet(params: z.infer<typeof createQuerySnippetSchema>) {
  try {
    const snippetData: CreateQuerySnippetRequest = {
      trigger: params.trigger,
      description: params.description,
      snippet: params.snippet
    };
    const result = await getRedashClient().createQuerySnippet(snippetData);
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
  snippetId: z.coerce.number().describe("ID of the snippet to update"),
  trigger: z.string().optional().describe("Trigger keyword for the snippet"),
  description: z.string().optional().describe("Description of the snippet"),
  snippet: z.string().optional().describe("The SQL snippet content")
});

async function updateQuerySnippet(params: z.infer<typeof updateQuerySnippetSchema>) {
  try {
    const { snippetId, ...updateData } = params;
    const snippetData: UpdateQuerySnippetRequest = {};
    if (updateData.trigger !== undefined) snippetData.trigger = updateData.trigger;
    if (updateData.description !== undefined) snippetData.description = updateData.description;
    if (updateData.snippet !== undefined) snippetData.snippet = updateData.snippet;

    const result = await getRedashClient().updateQuerySnippet(snippetId, snippetData);
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
  snippetId: z.coerce.number().describe("ID of the snippet to delete")
});

async function deleteQuerySnippet(params: z.infer<typeof deleteQuerySnippetSchema>) {
  try {
    const result = await getRedashClient().deleteQuerySnippet(params.snippetId);
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
    const result = await getRedashClient().getDestinations();
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
async function listRedashResources() {
  try {
    const [queries, dashboards] = await Promise.all([
      getRedashClient().getQueries(1, 100),
      getRedashClient().getDashboards(1, 100),
    ]);
    const queryResources = queries.results.map(query => ({
      uri: `redash://query/${query.id}`,
      name: query.name,
      description: query.description || `Query ID: ${query.id}`
    }));

    const dashboardResources = dashboards.results.map(dashboard => ({
      uri: `redash://dashboard/${dashboard.id}`,
      name: dashboard.name,
      description: `Dashboard ID: ${dashboard.id}`
    }));

    return {
      resources: [...queryResources, ...dashboardResources]
    };
  } catch (error) {
    logger.error(`Error listing resources: ${error instanceof Error ? error.message : String(error)}`);
    return {
      resources: []
    };
  }
}

async function readRedashResource(uri: URL, variables: Variables) {
  try {
    const type = getResourceVariable(variables.type, "type", uri);
    const resourceId = Number.parseInt(getResourceVariable(variables.id, "id", uri), 10);

    if (!Number.isSafeInteger(resourceId) || resourceId < 0) {
      throw new Error(`Invalid resource URI: ${uri.href}`);
    }

    if (type === "query") {
      const query = await getRedashClient().getQuery(resourceId);
      const result = await getRedashClient().executeQuery(resourceId);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              query: query,
              result: result
            }, null, 2)
          }
        ]
      };
    } else if (type === "dashboard") {
      const dashboard = await getRedashClient().getDashboard(resourceId);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(dashboard, null, 2)
          }
        ]
      };
    }

    throw new Error(`Unsupported resource type: ${type}`);
  } catch (error) {
    logger.error(`Error reading resource ${uri.href}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function getResourceVariable(value: string | string[] | undefined, name: string, uri: URL): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${name} in resource URI: ${uri.href}`);
  }

  return value;
}

export const toolDefinitions = [
  defineTool("list_queries", "List all available queries in Redash", listQueries, listQueriesSchema),
  defineTool("get_query", "Get details of a specific query", getQuery, getQuerySchema),
  defineTool("create_query", "Create a new query in Redash", createQuery, createQuerySchema),
  defineTool("update_query", "Update an existing query in Redash", updateQuery, updateQuerySchema),
  defineTool("get_query_parameters", "Get the saved parameter definitions for a query", getQueryParameters, getQueryParametersSchema),
  defineTool("update_query_parameters", "Update a query's saved parameter definitions", updateQueryParameters, updateQueryParametersSchema),
  defineTool("archive_query", "Archive (soft-delete) a query in Redash", archiveQuery, archiveQuerySchema),
  defineTool("list_data_sources", "List all available data sources in Redash", listDataSources),
  defineTool("execute_query", "Execute a Redash query and return results", executeQuery, executeQuerySchema),
  defineTool(
    "execute_parameterized_query",
    "Execute a saved parameterized query using its saved parameter definitions and defaults",
    executeParameterizedQuery,
    executeParameterizedQuerySchema,
  ),
  defineTool(
    "get_query_results_csv",
    "Get query results in CSV format. Returns the last cached results, or optionally refreshes the query first to get the latest data. Note: Does not support parameterized queries.",
    getQueryResultsCsv,
    getQueryResultsCsvSchema,
  ),
  defineTool("list_dashboards", "List all available dashboards in Redash", listDashboards, listDashboardsSchema),
  defineTool("get_dashboard", "Get details of a specific dashboard", getDashboard, getDashboardSchema),
  defineTool("get_dashboard_layout", "Get the current widget layout for a dashboard", getDashboardLayout, getDashboardLayoutSchema),
  defineTool("get_dashboard_by_slug", "Get details of a specific dashboard by its slug", getDashboardBySlug, getDashboardBySlugSchema),
  defineTool("get_visualization", "Get details of a specific visualization", getVisualization, getVisualizationSchema),
  defineTool(
    "execute_adhoc_query",
    "Execute an ad-hoc query without saving it to Redash. Creates a temporary query that is automatically deleted after execution.",
    executeAdhocQuery,
    executeAdhocQuerySchema,
  ),
  defineTool("create_visualization", "Create a new visualization for a query", createVisualization, createVisualizationSchema),
  defineTool("update_visualization", "Update an existing visualization", updateVisualization, updateVisualizationSchema),
  defineTool(
    "update_chart_visualization",
    "Update chart-specific visualization options and merge them with the current Redash chart config by default",
    updateChartVisualization,
    chartVisualizationUpdateSchema,
  ),
  defineTool("delete_visualization", "Delete a visualization", deleteVisualization, deleteVisualizationSchema),
  defineTool("get_schema", "Get schema of a specific data source", getSchema, getSchemaSchema),
  defineTool("create_dashboard", "Create a new dashboard in Redash", createDashboard, createDashboardSchema),
  defineTool("update_dashboard", "Update an existing dashboard in Redash", updateDashboard, updateDashboardSchema),
  defineTool("get_dashboard_parameters", "Get the current dashboard parameter values and widget mappings", getDashboardParameters, getDashboardParametersSchema),
  defineTool("update_dashboard_parameters", "Update dashboard parameter values and ordering", updateDashboardParameters, updateDashboardParametersSchema),
  defineTool("archive_dashboard", "Archive (soft-delete) a dashboard in Redash", archiveDashboard, archiveDashboardSchema),
  defineTool("fork_dashboard", "Fork (duplicate) an existing dashboard", forkDashboard, forkDashboardSchema),
  defineTool("get_public_dashboard", "Get a public dashboard by its share token", getPublicDashboard, getPublicDashboardSchema),
  defineTool("share_dashboard", "Share a dashboard and create a public link", shareDashboard, shareDashboardSchema),
  defineTool("unshare_dashboard", "Unshare a dashboard and revoke its public link", unshareDashboard, unshareDashboardSchema),
  defineTool("get_my_dashboards", "Get dashboards created by the current user", getMyDashboards, getMyDashboardsSchema),
  defineTool("get_favorite_dashboards", "Get dashboards marked as favorite by the current user", getFavoriteDashboards, getFavoriteDashboardsSchema),
  defineTool("add_dashboard_favorite", "Add a dashboard to favorites", addDashboardFavorite, addDashboardFavoriteSchema),
  defineTool("remove_dashboard_favorite", "Remove a dashboard from favorites", removeDashboardFavorite, removeDashboardFavoriteSchema),
  defineTool("get_dashboard_tags", "Get all tags used in dashboards", getDashboardTags),
  defineTool("list_alerts", "List all alerts in Redash", listAlerts),
  defineTool("get_alert", "Get details of a specific alert", getAlert, getAlertSchema),
  defineTool(
    "create_alert",
    "Create a new alert in Redash. Alerts notify you when a query result meets a specified condition.",
    createAlert,
    createAlertSchema,
  ),
  defineTool("update_alert", "Update an existing alert in Redash", updateAlert, updateAlertSchema),
  defineTool("delete_alert", "Delete an alert from Redash", deleteAlert, deleteAlertSchema),
  defineTool("mute_alert", "Mute an alert to temporarily stop notifications", muteAlert, muteAlertSchema),
  defineTool("get_alert_subscriptions", "Get all subscriptions for an alert", getAlertSubscriptions, getAlertSubscriptionsSchema),
  defineTool("add_alert_subscription", "Subscribe to an alert to receive notifications", addAlertSubscription, addAlertSubscriptionSchema),
  defineTool("remove_alert_subscription", "Unsubscribe from an alert", removeAlertSubscription, removeAlertSubscriptionSchema),
  defineTool("fork_query", "Fork (duplicate) an existing query", forkQuery, forkQuerySchema),
  defineTool("get_my_queries", "Get queries created by the current user", getMyQueries, getMyQueriesSchema),
  defineTool("get_recent_queries", "Get recently accessed queries", getRecentQueries, getRecentQueriesSchema),
  defineTool("get_query_tags", "Get all tags used in queries", getQueryTags),
  defineTool("get_favorite_queries", "Get queries marked as favorite by the current user", getFavoriteQueries, getFavoriteQueriesSchema),
  defineTool("add_query_favorite", "Add a query to favorites", addQueryFavorite, addQueryFavoriteSchema),
  defineTool("remove_query_favorite", "Remove a query from favorites", removeQueryFavorite, removeQueryFavoriteSchema),
  defineTool("list_widgets", "List all widgets", listWidgets),
  defineTool("get_widget", "Get details of a specific widget", getWidget, getWidgetSchema),
  defineTool("create_widget", "Create a new widget on a dashboard", createWidget, createWidgetSchema),
  defineTool("update_widget", "Update an existing widget", updateWidget, updateWidgetSchema),
  defineTool("update_widget_layout", "Move or resize a single widget by updating its grid position", updateWidgetLayout, updateWidgetLayoutSchema),
  defineTool(
    "update_dashboard_layout",
    "Move or resize multiple widgets on a dashboard in one call and report per-widget outcomes",
    updateDashboardLayout,
    updateDashboardLayoutSchema,
  ),
  defineTool("get_widget_parameter_mappings", "Get the parameter mappings for a widget", getWidgetParameterMappings, getWidgetParameterMappingsSchema),
  defineTool("update_widget_parameter_mappings", "Update a widget's parameter mappings", updateWidgetParameterMappings, updateWidgetParameterMappingsSchema),
  defineTool("delete_widget", "Delete a widget from a dashboard", deleteWidget, deleteWidgetSchema),
  defineTool("list_query_snippets", "List all reusable query snippets", listQuerySnippets),
  defineTool("get_query_snippet", "Get details of a specific query snippet", getQuerySnippet, getQuerySnippetSchema),
  defineTool("create_query_snippet", "Create a new reusable query snippet", createQuerySnippet, createQuerySnippetSchema),
  defineTool("update_query_snippet", "Update an existing query snippet", updateQuerySnippet, updateQuerySnippetSchema),
  defineTool("delete_query_snippet", "Delete a query snippet", deleteQuerySnippet, deleteQuerySnippetSchema),
  defineTool("list_destinations", "List all alert notification destinations (email, Slack, etc.)", listDestinations),
];

const redashResourceTemplate = new ResourceTemplate("redash://{type}/{id}", {
  list: listRedashResources,
});

export function createRedashMcpServer(): McpServer {
  const server = new McpServer({
    name: "redash-mcp",
    version: "1.1.0",
  });

  for (const tool of toolDefinitions) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: Record<string, unknown>) => {
        logger.debug(`Tool request received: ${tool.name} with args: ${JSON.stringify(args)}`);
        return await tool.handler(args) as CallToolResult;
      },
    );
  }

  server.registerResource(
    "redash-resource",
    redashResourceTemplate,
    {
      description: "A saved Redash query or dashboard",
    },
    readRedashResource,
  );

  return server;
}

// Start the server with stdio transport
export async function startStdioServer(options: ServeStdioOptions = {}): Promise<StdioServerHandle> {
  logger.info("Starting Redash MCP server...");
  const handle = serveStdio(
    () => {
      const server = createRedashMcpServer();
      logger.setServer(server);
      return server;
    },
    {
      ...options,
      onerror: (error) => {
        options.onerror?.(error);
        logger.error(`Stdio transport error: ${error.message}`);
      },
    },
  );
  logger.info("Redash MCP stdio server ready!");
  return handle;
}
