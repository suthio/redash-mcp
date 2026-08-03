import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type Transport } from "@modelcontextprotocol/server";
import { jest } from "@jest/globals";
import { createRedashMcpServer, startStdioServer, toolDefinitions } from "../index.js";
import { PACKAGE_VERSION } from "../packageInfo.js";
import { getRedashClient } from "../redashClient.js";
import { CLIENT_VERSION_MATRIX } from "./clientFixtures.js";

const redashClient = getRedashClient();

describe("Redash MCP server", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("defines all 67 public tools", () => {
    expect(toolDefinitions).toHaveLength(67);
  });

  it("advertises the published package version", async () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    const connection = await connectDirectClient();

    try {
      expect(PACKAGE_VERSION).toBe(manifest.version);
      expect(connection.client.getServerVersion()).toMatchObject({
        name: "redash-mcp",
        version: PACKAGE_VERSION,
      });
    } finally {
      await connection.close();
    }
  });

  it("registers every defined tool with descriptions and Zod-generated input schemas", async () => {
    const connection = await connectDirectClient();

    try {
      const result = await connection.client.listTools();
      expect(result.tools).toHaveLength(toolDefinitions.length);

      const getQuery = result.tools.find((tool) => tool.name === "get_query");
      expect(getQuery?.description).toBe("Get details of a specific query");
      expect(getQuery?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          queryId: {
            description: "ID of the query to get",
          },
        },
        required: ["queryId"],
      });

      const listQueries = result.tools.find((tool) => tool.name === "list_queries");
      expect(listQueries?.inputSchema).toMatchObject({
        properties: {
          page: { description: "Page number (starts at 1)" },
          pageSize: { description: "Number of results per page" },
          q: { description: "Search query" },
        },
      });

      const getSchema = result.tools.find((tool) => tool.name === "get_schema");
      expect(getSchema?.inputSchema).toMatchObject({
        properties: {
          pageSize: {
            default: 25,
            maximum: 100,
            description: "Number of tables per page (max 100)",
          },
        },
      });
      expect(getSchema?.inputSchema).not.toHaveProperty("properties.location");
      expect(getSchema?.description).toContain(
        "Query Results data sources are unsupported because their tables are created dynamically",
      );
    } finally {
      await connection.close();
    }
  });

  it("uses Zod coercion before invoking a tool handler", async () => {
    const getQuerySpy = jest.spyOn(redashClient, "getQuery").mockResolvedValue({
      id: 42,
      name: "Revenue",
    } as never);
    const connection = await connectDirectClient();

    try {
      const result = await connection.client.callTool({
        name: "get_query",
        arguments: { queryId: "42" },
      });

      expect(result.isError).not.toBe(true);
      expect(getQuerySpy).toHaveBeenCalledWith(42);
    } finally {
      await connection.close();
    }
  });

  it("passes pagination and search arguments through get_schema", async () => {
    const schemaPage = {
      page: 2,
      pageSize: 10,
      hasMore: false,
      nextPage: null,
      schema: [{ name: "users", columns: [{ name: "id", type: "integer" }] }],
    };
    const getSchemaPageSpy = jest
      .spyOn(redashClient, "getSchemaPage")
      .mockResolvedValue(schemaPage as never);
    const connection = await connectDirectClient();

    try {
      const result = await connection.client.callTool({
        name: "get_schema",
        arguments: { dataSourceId: "3", page: "2", pageSize: "10", search: "user" },
      });

      expect(result.isError).not.toBe(true);
      expect(getSchemaPageSpy).toHaveBeenCalledWith(3, 2, 10, "user");
      const [content] = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content.text)).toEqual(schemaPage);
    } finally {
      await connection.close();
    }
  });

  it("returns a pending Redash schema job unchanged", async () => {
    const schemaJob = {
      job: {
        id: "schema-job-123",
        updated_at: 0,
        status: 1,
        error: "",
        result: null,
        query_result_id: null,
      },
    };
    jest.spyOn(redashClient, "getSchemaPage").mockResolvedValue(schemaJob);
    const connection = await connectDirectClient();

    try {
      const result = await connection.client.callTool({
        name: "get_schema",
        arguments: { dataSourceId: 3 },
      });

      expect(result.isError).not.toBe(true);
      const [content] = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content.text)).toEqual(schemaJob);
    } finally {
      await connection.close();
    }
  });

  it("returns actionable guidance when a data source has no static schema", async () => {
    jest.spyOn(redashClient, "getSchemaPage").mockRejectedValue(new Error(
      "Data source 13 is a Query Results data source and does not expose a static schema; "
      + "use execute_adhoc_query with query_<query_id> or cached_query_<query_id> instead",
    ));
    const connection = await connectDirectClient();

    try {
      const result = await connection.client.callTool({
        name: "get_schema",
        arguments: { dataSourceId: 13 },
      });

      expect(result.isError).toBe(true);
      const [content] = result.content as Array<{ type: string; text: string }>;
      expect(content.text).toContain("Query Results data source");
      expect(content.text).toContain("execute_adhoc_query");
      expect(content.text).toContain("query_<query_id>");
    } finally {
      await connection.close();
    }
  });

  it("lists query and dashboard resources and reads both URI types", async () => {
    jest.spyOn(redashClient, "getQueries").mockResolvedValue({
      results: [{ id: 11, name: "Revenue", description: "Monthly revenue" }],
    } as never);
    jest.spyOn(redashClient, "getDashboards").mockResolvedValue({
      results: [{ id: 22, name: "Executive" }],
    } as never);
    jest.spyOn(redashClient, "getQuery").mockResolvedValue({ id: 11, name: "Revenue" } as never);
    jest.spyOn(redashClient, "executeQuery").mockResolvedValue({ rows: [{ revenue: 100 }] } as never);
    jest.spyOn(redashClient, "getDashboard").mockResolvedValue({ id: 22, name: "Executive" } as never);
    const connection = await connectDirectClient();

    try {
      const listed = await connection.client.listResources();
      expect(listed.resources).toEqual([
        {
          uri: "redash://query/11",
          name: "Revenue",
          description: "Monthly revenue",
        },
        {
          uri: "redash://dashboard/22",
          name: "Executive",
          description: "Dashboard ID: 22",
        },
      ]);

      const query = await connection.client.readResource({ uri: "redash://query/11" });
      expect(JSON.parse(resourceText(query.contents[0]))).toEqual({
        query: { id: 11, name: "Revenue" },
        result: { rows: [{ revenue: 100 }] },
      });

      const dashboard = await connection.client.readResource({ uri: "redash://dashboard/22" });
      expect(JSON.parse(resourceText(dashboard.contents[0]))).toEqual({ id: 22, name: "Executive" });
    } finally {
      await connection.close();
    }
  });

  it("reports resource listing failures to the MCP client", async () => {
    jest.spyOn(redashClient, "getQueries").mockRejectedValue(new Error("Redash unavailable"));
    jest.spyOn(redashClient, "getDashboards").mockResolvedValue({ results: [] } as never);
    const connection = await connectDirectClient();

    try {
      await expect(connection.client.listResources()).rejects.toThrow("Redash unavailable");
    } finally {
      await connection.close();
    }
  });

  it.each(CLIENT_VERSION_MATRIX)("serves %s clients over the stdio entrypoint", async (_label, clientOptions) => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const handle = await startStdioServer({ transport: serverTransport });
    const client = new Client(
      { name: "stdio-test-client", version: "1.0.0" },
      clientOptions,
    );

    try {
      await client.connect(clientTransport);
      const result = await client.listTools();
      expect(result.tools).toHaveLength(toolDefinitions.length);
    } finally {
      await client.close();
      await handle.close();
    }
  });
});

async function connectDirectClient(): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createRedashMcpServer();
  const client = new Client({ name: "redash-mcp-test-client", version: "1.0.0" });

  await server.connect(serverTransport as Transport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function resourceText(content: { text: string } | { blob: string } | undefined): string {
  if (!content || !("text" in content)) {
    throw new Error("Expected a text resource");
  }

  return content.text;
}
