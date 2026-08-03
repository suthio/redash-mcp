import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createMcpHandler, validateOriginHeader } from "@modelcontextprotocol/server";
import { cors } from "hono/cors";
import { createRedashMcpServer } from "./index.js";
import { logger } from "./logger.js";
import { formatError } from "./utils.js";

// @modelcontextprotocol/hono stashes the request body it already parsed with
// c.set("parsedBody", ...); teach Hono's typed context about that key.
declare module "hono" {
  interface ContextVariableMap {
    parsedBody?: unknown;
  }
}

const FORCE_CLOSE_GRACE_PERIOD_MS = 5_000;
const HEALTH_CHECK_PATH = "/healthz";

export interface HttpServerConfig {
  host: string;
  port: number;
  path: string;
  allowedHosts: string[];
  allowedOrigins: string[];
}

export interface HttpServerHandle {
  server: HttpServer;
  close(): Promise<void>;
}

export async function startHttpServer(config: HttpServerConfig): Promise<HttpServerHandle> {
  const app = createMcpHonoApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
  });
  const handler = createMcpHandler(createRedashMcpServer, {
    legacy: "stateless",
    onerror: (error) => logger.error(`Streamable HTTP transport error: ${error.message}`),
  });

  if (config.allowedOrigins.length > 0) {
    app.use(config.path, cors({
      origin: (origin) => validateOriginHeader(origin, config.allowedOrigins).ok ? origin : undefined,
      allowMethods: ["POST"],
    }));
  }

  app.post(config.path, (context) => handler.fetch(context.req.raw, {
    parsedBody: context.get("parsedBody"),
  }));
  app.on(["GET", "DELETE"], config.path, methodNotAllowed);

  if (config.path === HEALTH_CHECK_PATH) {
    logger.warning(
      'MCP_HTTP_PATH is "/healthz"; disabling the health check endpoint so the MCP endpoint remains available.',
    );
  } else {
    app.get(HEALTH_CHECK_PATH, (context) => context.text("ok"));
  }

  return new Promise((resolve, reject) => {
    const httpServer = serve({
      fetch: app.fetch,
      hostname: config.host,
      port: config.port,
    }) as HttpServer;

    httpServer.once("error", reject);
    httpServer.once("listening", () => {
      httpServer.off("error", reject);
      httpServer.on("error", (error) => {
        logger.error(`HTTP server error: ${formatError(error)}`);
      });
      const address = httpServer.address() as AddressInfo | null;
      const port = address?.port ?? config.port;
      logger.info(`Redash MCP Streamable HTTP server listening on http://${formatHost(config.host)}:${port}${config.path}`);
      resolve(createHttpServerHandle(httpServer, handler.close));
    });
  });
}

function createHttpServerHandle(
  httpServer: HttpServer,
  closeMcpHandler: () => Promise<void>,
): HttpServerHandle {
  let closePromise: Promise<void> | undefined;

  const close = (): Promise<void> => {
    closePromise ??= closeHttpRuntime(httpServer, closeMcpHandler);
    return closePromise;
  };

  // Preserve cleanup when a caller closes the raw Node server directly.
  httpServer.once("close", () => {
    if (!closePromise) {
      void close().catch((error: unknown) => {
        logger.error(`Failed to close the HTTP MCP server cleanly: ${formatError(error)}`);
      });
    }
  });

  return { server: httpServer, close };
}

async function closeHttpRuntime(
  httpServer: HttpServer,
  closeMcpHandler: () => Promise<void>,
): Promise<void> {
  // Start MCP teardown first so long-lived streams are aborted before the
  // Node server waits for its active connections to drain.
  const results = await Promise.allSettled([
    closeMcpHandler(),
    closeNodeHttpServer(httpServer),
  ]);
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);

  if (errors.length > 0) {
    throw errors.length === 1
      ? errors[0]
      : new AggregateError(errors, "Failed to close the HTTP MCP server cleanly");
  }
}

async function closeNodeHttpServer(httpServer: HttpServer): Promise<void> {
  if (httpServer.listening) {
    const closed = promisify(httpServer.close.bind(httpServer))();
    httpServer.closeIdleConnections();
    const forceCloseTimer = setTimeout(() => {
      httpServer.closeAllConnections();
    }, FORCE_CLOSE_GRACE_PERIOD_MS);
    forceCloseTimer.unref();

    try {
      await closed;
    } finally {
      clearTimeout(forceCloseTimer);
    }
  }
}

function methodNotAllowed() {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Content-Type": "application/json",
      },
    },
  );
}

function formatHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }

  return host;
}
