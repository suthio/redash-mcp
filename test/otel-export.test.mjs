import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { test } from "node:test";
import { z } from "zod";
import { MODERN_MCP_PROTOCOL_VERSION } from "../dist/mcpProtocol.js";

const MCP_DURATION_BUCKETS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
const CHILD_FIXTURE = fileURLToPath(new URL("./fixtures/otel-app.mjs", import.meta.url));

test("exports correlated MCP traces, metrics, and logs over OTLP/HTTP JSON", { timeout: 30_000 }, async (t) => {
  const collector = await startCollector(t);
  const redash = await startFakeRedash(t);
  const child = await startInstrumentedServer(t, {
    collectorUrl: collector.baseUrl,
    redashUrl: redash.baseUrl,
    httpPath: "/redash-mcp",
  });
  const client = new Client(
    { name: "otel-export-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: MODERN_MCP_PROTOCOL_VERSION } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${child.port}/redash-mcp`),
  );

  await client.connect(transport);
  await client.callTool({
    name: "list_queries",
    arguments: {},
    _meta: {
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    },
  });
  await client.callTool({
    name: "create_query",
    arguments: {
      name: "Captured query definition",
      data_source_id: 1,
      query: "SELECT confidential_total FROM revenue",
      description: "Quarterly finance analysis",
      options: { parameters: [{ name: "quarter", value: "Q2" }] },
      tags: ["finance"],
    },
  });
  await client.callTool({
    name: "create_query",
    arguments: {
      name: "Rejected query definition",
      data_source_id: 1,
      query: "SELECT rejected_secret FROM revenue",
      description: "Rejected finance analysis",
      options: { parameters: [{ name: "account", value: 42 }] },
    },
  });
  await client.callTool({
    name: "execute_query",
    arguments: { queryId: 42, parameters: { account: "internal" } },
  });
  await client.callTool({
    name: "get_query_results_csv",
    arguments: { queryId: 42 },
  });
  await client.callTool({ name: "get_query", arguments: {} });
  await client.readResource({ uri: "redash://query/42" });
  await assert.rejects(
    client.request({ method: "custom/missing", params: {} }, z.object({})),
  );
  await client.close();
  await child.shutdown();

  assert.ok(collector.payloads.traces.length > 0, "trace exports should reach /v1/traces");
  assert.ok(
    collector.payloads.metrics.length > 0,
    `metric exports should reach /v1/metrics; requests=${collector.requests.join(",")}; stderr=${child.stderr()}`,
  );
  assert.ok(collector.payloads.logs.length > 0, "log exports should reach /v1/logs");

  const spans = collector.payloads.traces.flatMap(flattenSpans);
  const toolSpan = spans.find((span) => span.name === "tools/call list_queries");
  assert.ok(toolSpan, "the list_queries MCP span should be exported");
  assert.equal(toolSpan.traceId, "11111111111111111111111111111111");
  assert.equal(toolSpan.parentSpanId, "2222222222222222");
  assertAttributeSubset(spanAttributes(toolSpan), {
    "mcp.method.name": "tools/call",
    "mcp.protocol.version": MODERN_MCP_PROTOCOL_VERSION,
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": "list_queries",
    "network.protocol.name": "http",
    "network.transport": "tcp",
  });
  assert.ok(spanAttributes(toolSpan)["gen_ai.tool.call.arguments"]);
  assert.ok(
    spanAttributes(toolSpan)["gen_ai.tool.call.result"],
    `captured tool result missing: ${JSON.stringify(spanAttributes(toolSpan))}`,
  );

  const createSpan = spans.find((span) => span.name === "tools/call create_query");
  assert.ok(createSpan, "the create_query MCP span should be exported");
  const createArguments = JSON.parse(spanAttributes(createSpan)["gen_ai.tool.call.arguments"]);
  assert.deepEqual(createArguments, {
    name: "Captured query definition",
    data_source_id: 1,
    query: "SELECT confidential_total FROM revenue",
    description: "Quarterly finance analysis",
    options: { parameters: [{ name: "quarter", value: "Q2" }] },
    tags: ["finance"],
  });
  const createToolResult = JSON.parse(spanAttributes(createSpan)["gen_ai.tool.call.result"]);
  const createdQuery = JSON.parse(createToolResult.content[0].text);
  assert.equal(createdQuery.description, "Quarterly finance analysis");
  assert.deepEqual(createdQuery.options, { parameters: [{ name: "quarter", value: "Q2" }] });
  assert.deepEqual(createdQuery.visualizations, [{
    id: 91,
    type: "CHART",
    name: "Revenue chart",
    description: "Quarterly revenue",
    options: { globalSeriesType: "column" },
    query_id: 43,
  }]);

  const executeSpan = spans.find((span) => span.name === "tools/call execute_query");
  assert.ok(executeSpan, "the execute_query MCP span should be exported");
  const executeToolResult = JSON.parse(spanAttributes(executeSpan)["gen_ai.tool.call.result"]);
  const queryResult = JSON.parse(executeToolResult.content[0].text);
  assert.deepEqual(queryResult.query_result.data.rows, [{
    account: "internal",
    confidential_total: 1250,
  }]);

  const csvSpan = spans.find((span) => span.name === "tools/call get_query_results_csv");
  assert.ok(csvSpan, "the get_query_results_csv MCP span should be exported");
  const csvToolResult = JSON.parse(spanAttributes(csvSpan)["gen_ai.tool.call.result"]);
  assert.equal(csvToolResult.content[0].text, "account,confidential_total\ninternal,1250\n");

  const transportSpans = spans.filter((span) => {
    return span.name === "POST /redash-mcp"
      && spanAttributes(span)["http.route"] === "/redash-mcp";
  });
  assert.ok(transportSpans.length > 0, "the HTTP transport span should use the configured route");
  assert.ok(
    transportSpans.some((transportSpan) => {
      return (toolSpan.links ?? []).some((link) => {
        return link.traceId === transportSpan.traceId && link.spanId === transportSpan.spanId;
      });
    }),
    "the MCP span should link to its HTTP transport span",
  );

  const redashSpan = spans.find((span) => {
    const attributes = spanAttributes(span);
    return attributes["http.request.method"] === "GET"
      && String(attributes["url.full"] ?? "").includes("/api/queries");
  });
  assert.ok(redashSpan, "the outbound Redash request span should be exported");
  assert.equal(redashSpan.traceId, toolSpan.traceId);
  assert.equal(redashSpan.parentSpanId, toolSpan.spanId);

  const resourceSpan = spans.find((span) => span.name === "resources/read");
  assert.ok(resourceSpan, "the resource read span should be exported without its URI in the name");
  assert.equal(spanAttributes(resourceSpan)["mcp.resource.uri"], "redash://query/42");
  assert.equal(spans.some((span) => span.name.includes("redash://query/42")), false);

  const failedToolSpan = spans.find((span) => span.name === "tools/call get_query");
  assert.ok(failedToolSpan, "the failed tool span should be exported");
  assert.equal(spanAttributes(failedToolSpan)["error.type"], "tool_error");
  assert.equal("gen_ai.tool.call.result" in spanAttributes(failedToolSpan), false);

  const rpcErrorSpan = spans.find((span) => span.name === "custom/missing");
  assert.ok(rpcErrorSpan, "the JSON-RPC error span should be exported");
  assertAttributeSubset(spanAttributes(rpcErrorSpan), {
    "rpc.response.status_code": "-32601",
    "error.type": "-32601",
  });
  assert.equal(rpcErrorSpan.status?.code, 2);
  assert.ok(rpcErrorSpan.status?.message);

  const logRecords = collector.payloads.logs.flatMap(flattenLogs);
  const correlatedLog = logRecords.find((record) => record.body?.stringValue === "MCP tool request received");
  assert.ok(correlatedLog, "a tool log should be exported");
  assert.equal(correlatedLog.traceId, toolSpan.traceId);
  assert.equal(correlatedLog.spanId, toolSpan.spanId);

  const createLog = logRecords.find((record) => record.body?.stringValue === "Creating Redash query");
  assert.ok(createLog, "the safe Redash create-query log should be exported");
  assertAttributeSubset(otlpAttributes(createLog.attributes), {
    "http.request.method": "POST",
    "url.path": "/api/queries",
    "redash.data_source.id": 1,
  });
  assert.equal(
    JSON.stringify(otlpAttributes(createLog.attributes)).includes("confidential_total"),
    false,
    "successful query content should not be duplicated into OTel Logs",
  );

  const failedCreateLog = logRecords.find(
    (record) => record.body?.stringValue === "Redash create-query request failed",
  );
  assert.ok(failedCreateLog, "the Redash create-query failure log should be exported");
  const failedCreateAttributes = otlpAttributes(failedCreateLog.attributes);
  assertAttributeSubset(failedCreateAttributes, {
    "http.response.status_code": 400,
    "redash.request.body": {
      name: "Rejected query definition",
      data_source_id: 1,
      query: "SELECT rejected_secret FROM revenue",
      description: "Rejected finance analysis",
      options: { parameters: [{ name: "account", value: 42 }] },
      schedule: undefined,
      tags: [],
    },
    "redash.response.body": {
      message: "invalid query",
      detail: "SELECT rejected_secret failed validation",
    },
  });
  assert.equal(child.stderr().includes("rejected_secret"), false);
  assert.equal(JSON.stringify(failedCreateAttributes).includes("test-api-key"), false);

  const metrics = collector.payloads.metrics.flatMap(flattenMetrics);
  const operationMetrics = metrics.filter((metric) => metric.name === "mcp.server.operation.duration");
  const sessionMetrics = metrics.filter((metric) => metric.name === "mcp.server.session.duration");
  assert.ok(operationMetrics.length > 0, "the MCP operation histogram should be exported");
  assert.ok(sessionMetrics.length > 0, "the MCP session histogram should be exported");
  const operationMetric = operationMetrics.at(-1);
  const sessionMetric = sessionMetrics.at(-1);
  assert.ok(operationMetric);
  assert.ok(sessionMetric, "the MCP session histogram should be exported");
  assert.deepEqual(operationMetric.histogram.dataPoints[0].explicitBounds, MCP_DURATION_BUCKETS);
  assert.deepEqual(sessionMetric.histogram.dataPoints[0].explicitBounds, MCP_DURATION_BUCKETS);

  const toolPoint = operationMetrics.flatMap((metric) => metric.histogram.dataPoints).find((point) => {
    const attributes = otlpAttributes(point.attributes);
    return attributes["mcp.method.name"] === "tools/call"
      && attributes["gen_ai.tool.name"] === "list_queries";
  });
  assert.ok(toolPoint, "the tool duration point should have MCP and GenAI dimensions");
  assertAttributeSubset(otlpAttributes(toolPoint.attributes), {
    "mcp.protocol.version": MODERN_MCP_PROTOCOL_VERSION,
    "gen_ai.operation.name": "execute_tool",
    "network.protocol.name": "http",
  });

  const rpcErrorPoint = operationMetrics.flatMap((metric) => metric.histogram.dataPoints).find((point) => {
    return otlpAttributes(point.attributes)["mcp.method.name"] === "custom/missing";
  });
  assert.ok(rpcErrorPoint, "the JSON-RPC error duration point should be exported");
  assertAttributeSubset(otlpAttributes(rpcErrorPoint.attributes), {
    "rpc.response.status_code": "-32601",
    "error.type": "-32601",
  });
});

test("traces an MCP endpoint mounted at /metrics instead of suppressing it", { timeout: 30_000 }, async (t) => {
  const collector = await startCollector(t);
  const redash = await startFakeRedash(t);
  const child = await startInstrumentedServer(t, {
    collectorUrl: collector.baseUrl,
    redashUrl: redash.baseUrl,
    httpPath: "/metrics",
    prometheus: true,
  });
  const client = new Client(
    { name: "otel-metrics-route-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: MODERN_MCP_PROTOCOL_VERSION } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${child.port}/metrics`),
  );

  await client.connect(transport);
  await client.listTools();
  await client.close();
  await child.shutdown();

  const spans = collector.payloads.traces.flatMap(flattenSpans);
  const httpSpan = spans.find((span) => span.name === "POST /metrics");
  assert.ok(httpSpan, "the colliding MCP /metrics endpoint should still be traced");
  assert.equal(spanAttributes(httpSpan)["http.route"], "/metrics");
});

async function startCollector(t) {
  const payloads = { traces: [], metrics: [], logs: [] };
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push(request.url ?? "");
    const body = await readBody(request);
    const signal = request.url === "/v1/traces"
      ? "traces"
      : request.url === "/v1/metrics"
        ? "metrics"
        : request.url === "/v1/logs"
          ? "logs"
          : undefined;
    if (!signal) {
      response.writeHead(404).end();
      return;
    }
    payloads[signal].push(JSON.parse(body));
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  const baseUrl = await listen(server);
  t.after(() => closeServer(server));
  return { baseUrl, payloads, requests };
}

async function startFakeRedash(t) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://redash.test");
    let body;
    if (request.method === "GET" && url.pathname === "/api/queries") {
      body = { count: 1, page: 1, page_size: 25, results: [{ id: 42, name: "Revenue" }] };
    } else if (request.method === "GET" && url.pathname === "/api/queries/42") {
      body = { id: 42, name: "Revenue", query: "select 42", data_source_id: 1 };
    } else if (request.method === "POST" && url.pathname === "/api/queries/42/results") {
      await readBody(request);
      body = {
        query_result: {
          data: {
            columns: [
              { name: "account", type: "string" },
              { name: "confidential_total", type: "integer" },
            ],
            rows: [{ account: "internal", confidential_total: 1250 }],
          },
        },
      };
    } else if (request.method === "GET" && url.pathname === "/api/queries/42/results.csv") {
      response.writeHead(200, { "content-type": "text/csv" });
      response.end("account,confidential_total\ninternal,1250\n");
      return;
    } else if (request.method === "POST" && url.pathname === "/api/queries") {
      const requestBody = JSON.parse(await readBody(request));
      if (requestBody.name === "Rejected query definition") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({
          message: "invalid query",
          detail: "SELECT rejected_secret failed validation",
        }));
        return;
      }
      body = {
        id: 43,
        ...requestBody,
        visualizations: [{
          id: 91,
          type: "CHART",
          name: "Revenue chart",
          description: "Quarterly revenue",
          options: { globalSeriesType: "column" },
          query_id: 43,
        }],
      };
    } else {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "not found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  const baseUrl = await listen(server);
  t.after(() => closeServer(server));
  return { baseUrl };
}

async function startInstrumentedServer(t, options) {
  let stderr = "";
  const child = fork(CHILD_FIXTURE, [], {
    env: {
      ...process.env,
      REDASH_URL: options.redashUrl,
      REDASH_API_KEY: "test-api-key",
      OTEL_TEST_MCP_PATH: options.httpPath,
      OTEL_EXPORTER_OTLP_ENDPOINT: options.collectorUrl,
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_METRICS_EXPORTER: options.prometheus ? "otlp,prometheus" : "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_METRIC_EXPORT_INTERVAL: "100",
      OTEL_METRIC_EXPORT_TIMEOUT: "50",
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  t.after(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  });

  const ready = await waitForChildMessage(child, "ready", () => stderr);
  return {
    port: ready.port,
    stderr: () => stderr,
    async shutdown() {
      child.send({ type: "shutdown" });
      await waitForChildMessage(child, "stopped", () => stderr);
      if (child.connected) {
        child.disconnect();
      }
      const code = child.exitCode ?? (await once(child, "exit"))[0];
      assert.equal(code, 0, `instrumented child failed:\n${stderr}`);
    },
  };
}

function waitForChildMessage(child, expectedType, stderr) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type === expectedType) {
        cleanup();
        resolve(message);
      } else if (message?.type === "failure") {
        cleanup();
        reject(new Error(`${message.message}\n${stderr()}`));
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`instrumented child exited with ${code}:\n${stderr()}`));
    };
    const cleanup = () => {
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

async function readBody(request) {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body;
}

function flattenSpans(payload) {
  return (payload.resourceSpans ?? []).flatMap((resource) => {
    return (resource.scopeSpans ?? []).flatMap((scope) => scope.spans ?? []);
  });
}

function flattenMetrics(payload) {
  return (payload.resourceMetrics ?? []).flatMap((resource) => {
    return (resource.scopeMetrics ?? []).flatMap((scope) => scope.metrics ?? []);
  });
}

function flattenLogs(payload) {
  return (payload.resourceLogs ?? []).flatMap((resource) => {
    return (resource.scopeLogs ?? []).flatMap((scope) => scope.logRecords ?? []);
  });
}

function spanAttributes(span) {
  return otlpAttributes(span.attributes);
}

function otlpAttributes(attributes = []) {
  return Object.fromEntries(attributes.map((attribute) => [attribute.key, otlpValue(attribute.value)]));
}

function otlpValue(value = {}) {
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if ("intValue" in value) return Number(value.intValue);
  if ("doubleValue" in value) return value.doubleValue;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(otlpValue);
  if (value.kvlistValue) return otlpAttributes(value.kvlistValue.values);
  return undefined;
}

function assertAttributeSubset(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value, `unexpected telemetry attribute ${key}`);
  }
}
