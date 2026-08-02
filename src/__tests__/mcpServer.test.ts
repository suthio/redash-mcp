import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type Transport } from "@modelcontextprotocol/server";
import { jest } from "@jest/globals";
import { CLIENT_VERSION_MATRIX } from "./clientFixtures.js";

type IndexModule = typeof import("../index.js");
type RedashClientModule = typeof import("../redashClient.js");

let createRedashMcpServer: IndexModule["createRedashMcpServer"];
let startStdioServer: IndexModule["startStdioServer"];
let redashClient: RedashClientModule["redashClient"];

beforeAll(async () => {
  process.env.REDASH_URL = "https://redash.example.com";
  process.env.REDASH_API_KEY = "test-api-key";

  const indexModule = await import("../index.js");
  const redashClientModule = await import("../redashClient.js");
  createRedashMcpServer = indexModule.createRedashMcpServer;
  startStdioServer = indexModule.startStdioServer;
  redashClient = redashClientModule.redashClient;
});

describe("Redash MCP server", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("registers all 67 tools with descriptions and Zod-generated input schemas", async () => {
    const connection = await connectDirectClient();

    try {
      const result = await connection.client.listTools();
      expect(result.tools).toHaveLength(67);

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
      expect(result.tools).toHaveLength(67);
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
