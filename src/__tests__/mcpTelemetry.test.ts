import {
  SpanKind,
  SpanStatusCode,
  propagation,
  trace,
  type Context,
  type TextMapGetter,
} from "@opentelemetry/api";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import { TelemetryMcpServer } from "../mcpTelemetry.js";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

describe("MCP telemetry", () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator({
      inject: () => {},
      fields: () => ["traceparent"],
      extract: extractTraceparent,
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await provider.shutdown();
    propagation.disable();
    trace.disable();
  });

  it("creates SERVER spans for MCP operations and accepts SEP-414 trace context", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new TelemetryMcpServer(
      { name: "telemetry-test-server", version: "1.0.0" },
      undefined,
      { networkTransport: "pipe" },
    );
    server.registerTool(
      "echo",
      {
        description: "Echo a value",
        inputSchema: z.object({ text: z.string() }),
      },
      async ({ text }) => ({ content: [{ type: "text", text }] }),
    );
    const client = new Client({ name: "telemetry-test-client", version: "1.0.0" });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      await client.callTool({
        name: "echo",
        arguments: { text: "not-exported-by-default" },
        _meta: {
          traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
        },
      });
      await provider.forceFlush();

      const toolSpan = exporter.getFinishedSpans().find((span) => span.name === "tools/call echo");
      expect(toolSpan).toBeDefined();
      expect(toolSpan!.kind).toBe(SpanKind.SERVER);
      expect(toolSpan!.attributes).toMatchObject({
        "mcp.method.name": "tools/call",
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "echo",
        "network.transport": "pipe",
        "mcp.protocol.version": expect.any(String),
      });
      expect(toolSpan!.attributes).not.toHaveProperty("gen_ai.tool.call.arguments");
      expect(toolSpan!.attributes).not.toHaveProperty("gen_ai.tool.call.result");
      expect(toolSpan!.parentSpanContext?.traceId).toBe("11111111111111111111111111111111");
      expect(toolSpan!.parentSpanContext?.spanId).toBe("2222222222222222");

      const initializeSpan = exporter.getFinishedSpans().find((span) => span.name === "initialize");
      expect(initializeSpan?.attributes["mcp.protocol.version"]).toBe(
        toolSpan!.attributes["mcp.protocol.version"],
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps resource URIs out of span names and records prompt names", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new TelemetryMcpServer(
      { name: "telemetry-test-server", version: "1.0.0" },
      undefined,
      { networkTransport: "pipe" },
    );
    server.registerResource(
      "example-resource",
      "example://queries/42",
      { description: "Example resource" },
      async (uri) => ({ contents: [{ uri: uri.href, text: "example" }] }),
    );
    server.registerPrompt(
      "analyze-code",
      { description: "Analyze code", argsSchema: z.object({ code: z.string() }) },
      async ({ code }) => ({
        messages: [{ role: "user", content: { type: "text", text: code } }],
      }),
    );
    const client = new Client({ name: "telemetry-test-client", version: "1.0.0" });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      await client.readResource({ uri: "example://queries/42" });
      await client.getPrompt({ name: "analyze-code", arguments: { code: "const x = 1" } });
      await provider.forceFlush();

      const resourceSpan = exporter.getFinishedSpans().find((span) => span.name === "resources/read");
      expect(resourceSpan?.attributes).toMatchObject({
        "mcp.method.name": "resources/read",
        "mcp.resource.uri": "example://queries/42",
      });
      expect(exporter.getFinishedSpans()).not.toContainEqual(
        expect.objectContaining({ name: expect.stringContaining("example://queries/42") }),
      );

      const promptSpan = exporter.getFinishedSpans().find(
        (span) => span.name === "prompts/get analyze-code",
      );
      expect(promptSpan?.attributes).toMatchObject({
        "mcp.method.name": "prompts/get",
        "gen_ai.prompt.name": "analyze-code",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("uses standard JSON-RPC error attributes and status descriptions", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new TelemetryMcpServer(
      { name: "telemetry-test-server", version: "1.0.0" },
      undefined,
      { networkTransport: "pipe" },
    );
    const client = new Client({ name: "telemetry-test-client", version: "1.0.0" });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      await expect(
        client.request({ method: "custom/missing", params: {} }, z.object({})),
      ).rejects.toThrow();
      await provider.forceFlush();

      const span = exporter.getFinishedSpans().find((candidate) => candidate.name === "custom/missing");
      expect(span?.attributes).toMatchObject({
        "rpc.response.status_code": "-32601",
        "error.type": "-32601",
      });
      expect(span?.attributes).not.toHaveProperty("rpc.jsonrpc.error_code");
      expect(span?.status.code).toBe(SpanStatusCode.ERROR);
      expect(span?.status.message).toEqual(expect.any(String));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("classifies CallToolResult failures as tool_error", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new TelemetryMcpServer(
      { name: "telemetry-test-server", version: "1.0.0" },
      undefined,
      { networkTransport: "pipe" },
    );
    server.registerTool(
      "fail",
      { inputSchema: z.object({}) },
      async () => ({ isError: true, content: [{ type: "text", text: "failed" }] }),
    );
    const client = new Client({ name: "telemetry-test-client", version: "1.0.0" });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      await client.callTool({ name: "fail", arguments: {} });
      await provider.forceFlush();

      const span = exporter.getFinishedSpans().find((candidate) => candidate.name === "tools/call fail");
      expect(span?.attributes["error.type"]).toBe("tool_error");
      expect(span?.status.code).toBe(SpanStatusCode.ERROR);
      expect(span?.attributes).not.toHaveProperty("gen_ai.tool.call.result");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

function extractTraceparent(
  base: Context,
  carrier: unknown,
  getter: TextMapGetter,
): Context {
  const value = getter.get(carrier, "traceparent");
  const traceparent = Array.isArray(value) ? value[0] : value;
  const match = typeof traceparent === "string"
    ? /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(traceparent)
    : null;
  if (!match) {
    return base;
  }

  return trace.setSpanContext(base, {
    traceId: match[1],
    spanId: match[2],
    traceFlags: Number.parseInt(match[3], 16),
    isRemote: true,
  });
}
