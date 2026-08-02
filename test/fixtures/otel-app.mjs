import process from "node:process";

const httpPath = process.env.OTEL_TEST_MCP_PATH || "/redash-mcp";
const { initializeTelemetry, shutdownTelemetry } = await import("../../dist/telemetry.js");

await initializeTelemetry({ transport: "http", httpPath });
const { startHttpServer } = await import("../../dist/httpServer.js");
const handle = await startHttpServer({
  host: "127.0.0.1",
  port: 0,
  path: httpPath,
  allowedHosts: ["127.0.0.1", "localhost"],
  allowedOrigins: [],
});
const address = handle.server.address();

if (!address || typeof address === "string") {
  throw new Error("The test HTTP server did not expose a TCP port.");
}

process.send?.({ type: "ready", port: address.port });

process.on("message", (message) => {
  if (!message || message.type !== "shutdown") {
    return;
  }

  void (async () => {
    try {
      await handle.close();
      await recordStdioSession();
      await shutdownTelemetry();
      process.send?.({ type: "stopped" });
      process.disconnect?.();
    } catch (error) {
      process.send?.({
        type: "failure",
        message: error instanceof Error ? error.stack ?? error.message : String(error),
      });
      process.disconnect?.();
      process.exitCode = 1;
    }
  })();
});

async function recordStdioSession() {
  const { Client } = await import("@modelcontextprotocol/client");
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  const { TelemetryMcpServer } = await import("../../dist/mcpTelemetry.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new TelemetryMcpServer(
    { name: "otel-session-test", version: "1.0.0" },
    undefined,
    { networkTransport: "pipe", recordSession: true },
  );
  const client = new Client({ name: "otel-session-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.close();
  await server.close();
}
