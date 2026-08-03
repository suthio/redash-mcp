import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { createConnection } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { jest } from "@jest/globals";
import { LOOPBACK_ALLOWED_HOSTNAMES } from "../config.js";
import { startHttpServer, type HttpServerHandle } from "../httpServer.js";
import { toolDefinitions } from "../index.js";
import {
  hasEmbeddedPrometheusMetrics,
  initializeTelemetry,
  shutdownTelemetry,
} from "../telemetry.js";
import { CLIENT_VERSION_MATRIX, MODERN_CLIENT_OPTIONS } from "./clientFixtures.js";

type HttpServerConfig = Parameters<typeof startHttpServer>[0];

const LOOPBACK_HOSTNAMES = [...LOOPBACK_ALLOWED_HOSTNAMES];

const openHandles: HttpServerHandle[] = [];

describe("HTTP MCP server", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    await Promise.all(openHandles.splice(0).map((handle) => handle.close()));
    consoleErrorSpy.mockRestore();
  });

  it("returns 405 for GET and DELETE on the MCP endpoint", async () => {
    const serverInfo = await startTestServer();

    const getResponse = await fetch(`${serverInfo.baseUrl}/mcp`);
    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get("allow")).toBe("POST");

    const deleteResponse = await fetch(`${serverInfo.baseUrl}/mcp`, { method: "DELETE" });
    expect(deleteResponse.status).toBe(405);
    expect(deleteResponse.headers.get("allow")).toBe("POST");
  });

  it("serves a lightweight health check on GET /healthz", async () => {
    const serverInfo = await startTestServer();

    const response = await fetch(`${serverInfo.baseUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain(?:;|$)/);
    expect(await response.text()).toBe("ok");
  });

  it("protects the health check with the configured Host and Origin allowlists", async () => {
    const serverInfo = await startTestServer();

    const unexpectedHostStatus = await requestStatus(new URL(`${serverInfo.baseUrl}/healthz`), {
      method: "GET",
      headers: { Host: "attacker.example.com" },
    }, "");
    expect(unexpectedHostStatus).toBe(403);

    const unexpectedOriginResponse = await fetch(`${serverInfo.baseUrl}/healthz`, {
      headers: { Origin: "https://attacker.example.com" },
    });
    expect(unexpectedOriginResponse.status).toBe(403);
  });

  it("preserves an MCP endpoint configured at /healthz", async () => {
    const serverInfo = await startTestServer({ path: "/healthz" });
    const getResponse = await fetch(`${serverInfo.baseUrl}/healthz`);

    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get("allow")).toBe("POST");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[WARNING] MCP_HTTP_PATH is "/healthz"; disabling the health check endpoint so the MCP endpoint remains available.',
    );

    const transport = new StreamableHTTPClientTransport(new URL(`${serverInfo.baseUrl}/healthz`));
    const client = new Client(
      { name: "health-route-collision-test", version: "1.0.0" },
      MODERN_CLIENT_OPTIONS,
    );

    try {
      await client.connect(transport);
      const result = await client.listTools();
      expect(result.tools).toHaveLength(toolDefinitions.length);
    } finally {
      await client.close();
    }
  });

  it("returns 404 for unknown paths", async () => {
    const serverInfo = await startTestServer();

    const response = await fetch(`${serverInfo.baseUrl}/not-mcp`);
    expect(response.status).toBe(404);
  });

  it("keeps /metrics available for MCP when it collides with embedded Prometheus", async () => {
    const previousExporter = process.env.OTEL_METRICS_EXPORTER;
    process.env.OTEL_METRICS_EXPORTER = "prometheus";

    try {
      await initializeTelemetry({ transport: "http" });
      expect(hasEmbeddedPrometheusMetrics()).toBe(true);
      const serverInfo = await startTestServer({ path: "/metrics" });

      expect(hasEmbeddedPrometheusMetrics()).toBe(false);
      const getResponse = await fetch(`${serverInfo.baseUrl}/metrics`);
      expect(getResponse.status).toBe(405);
      expect(getResponse.headers.get("allow")).toBe("POST");
    } finally {
      await shutdownTelemetry();
      if (previousExporter === undefined) {
        delete process.env.OTEL_METRICS_EXPORTER;
      } else {
        process.env.OTEL_METRICS_EXPORTER = previousExporter;
      }
    }
  });

  it("rejects non-local browser origins", async () => {
    const serverInfo = await startTestServer();

    const response = await fetch(`${serverInfo.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });

    expect(response.status).toBe(403);
  });

  it("allows configured browser origins and handles CORS preflight", async () => {
    const serverInfo = await startTestServer({
      allowedOrigins: ["app.example.com"],
    });
    const origin = "https://app.example.com:8443";

    const preflightResponse = await fetch(`${serverInfo.baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,mcp-protocol-version",
      },
    });

    expect(preflightResponse.status).toBe(204);
    expect(preflightResponse.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflightResponse.headers.get("access-control-allow-methods")).toBe("POST");
    expect(preflightResponse.headers.get("access-control-allow-headers")).toBe("content-type,mcp-protocol-version");

    const postResponse = await fetch(`${serverInfo.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });

    expect(postResponse.status).not.toBe(403);
    expect(postResponse.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("rejects every browser Origin when the Origin allowlist is empty", async () => {
    const serverInfo = await startTestServer({ allowedOrigins: [] });

    const response = await fetch(`${serverInfo.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects an unexpected Host header on a loopback bind", async () => {
    const serverInfo = await startTestServer();

    const responseStatus = await requestStatus(new URL(`${serverInfo.baseUrl}/mcp`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "attacker.example.com",
      },
    }, JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }));

    expect(responseStatus).toBe(403);
  });

  it("accepts an explicitly allowed Host header", async () => {
    const serverInfo = await startTestServer({
      allowedHosts: ["mcp.example.com"],
    });

    const responseStatus = await requestStatus(new URL(`${serverInfo.baseUrl}/mcp`), {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Host: "mcp.example.com",
      },
    }, JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }));

    expect(responseStatus).not.toBe(403);
  });

  it("returns 400 for malformed JSON", async () => {
    const serverInfo = await startTestServer();

    const response = await fetch(`${serverInfo.baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });

    expect(response.status).toBe(400);
  });

  it.each(CLIENT_VERSION_MATRIX)("supports a %s MCP client without creating a session", async (_label, clientOptions) => {
    const serverInfo = await startTestServer();
    const transport = new StreamableHTTPClientTransport(new URL(`${serverInfo.baseUrl}/mcp`));
    const client = new Client(
      {
        name: "redash-mcp-test-client",
        version: "1.0.0",
      },
      clientOptions,
    );

    try {
      await client.connect(transport);
      expect(transport.sessionId).toBeUndefined();

      const result = await client.listTools();
      expect(result.tools).toHaveLength(toolDefinitions.length);
      expect(result.tools.some((tool) => tool.name === "list_queries")).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("closes the MCP handler and HTTP listener idempotently", async () => {
    const serverInfo = await startTestServer();

    await serverInfo.handle.close();
    await serverInfo.handle.close();

    expect(serverInfo.handle.server.listening).toBe(false);
  });

  it("logs HTTP server errors emitted after startup", async () => {
    const serverInfo = await startTestServer();

    serverInfo.handle.server.emit("error", new Error("post-start failure"));

    expect(consoleErrorSpy).toHaveBeenCalledWith("[ERROR] HTTP server error: post-start failure");
  });

  it("force-closes active connections after the shutdown grace period", async () => {
    const serverInfo = await startTestServer();
    const address = serverInfo.handle.server.address() as AddressInfo;
    const socket = createConnection({ host: "127.0.0.1", port: address.port });
    await once(socket, "connect");
    socket.write([
      "POST /mcp HTTP/1.1",
      "Host: 127.0.0.1",
      "Content-Type: application/json",
      "Content-Length: 1000",
      "",
      "{",
    ].join("\r\n"));

    jest.useFakeTimers();
    try {
      socket.on("error", () => {
        // Forced shutdown resets an incomplete HTTP request by design.
      });
      const socketClosed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
      const closePromise = serverInfo.handle.close();
      await jest.advanceTimersByTimeAsync(5_000);
      await closePromise;
      await socketClosed;

      expect(socket.destroyed).toBe(true);
      expect(serverInfo.handle.server.listening).toBe(false);
    } finally {
      jest.useRealTimers();
      socket.destroy();
    }
  });

  it("ends an active MCP subscription before the HTTP listener closes", async () => {
    const serverInfo = await startTestServer();
    const transport = new StreamableHTTPClientTransport(new URL(`${serverInfo.baseUrl}/mcp`));
    const client = new Client(
      { name: "shutdown-test-client", version: "1.0.0" },
      MODERN_CLIENT_OPTIONS,
    );

    try {
      await client.connect(transport);
      const subscription = await client.listen({ toolsListChanged: true });

      await serverInfo.handle.close();

      expect(await subscription.closed).toBe("graceful");
      expect(serverInfo.handle.server.listening).toBe(false);
    } finally {
      await client.close();
    }
  });
});

async function startTestServer(
  overrides: Partial<HttpServerConfig> = {},
): Promise<{ handle: HttpServerHandle; baseUrl: string }> {
  const handle = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    path: "/mcp",
    allowedHosts: LOOPBACK_HOSTNAMES,
    allowedOrigins: LOOPBACK_HOSTNAMES,
    ...overrides,
  });
  openHandles.push(handle);
  const address = handle.server.address() as AddressInfo;

  return {
    handle,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function requestStatus(
  url: URL,
  options: { method: string; headers: Record<string, string> },
  body: string,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const outgoingRequest = request(url, options, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    outgoingRequest.once("error", reject);
    outgoingRequest.end(body);
  });
}
