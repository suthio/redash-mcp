import { parseServerConfig, type ServerConfig } from "./config.js";
import { logger } from "./logger.js";
import { initializeTelemetry, shutdownTelemetry } from "./telemetry.js";
import { formatError } from "./utils.js";

export interface ServerHandle {
  close(): Promise<void>;
}

export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface ShutdownSignalTarget {
  exitCode?: number | string;
  once(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

export interface GracefulShutdownController {
  shutdown(signal: ShutdownSignal): Promise<void>;
}

async function startConfiguredServer(config: ServerConfig): Promise<ServerHandle> {
  // Instantiate the client up front so missing credentials fail at startup,
  // not on the first tool call. Import it after telemetry initialization so
  // OpenTelemetry can patch node:http before Axios loads.
  const { getRedashClient } = await import("./redashClient.js");
  getRedashClient();

  if (config.transport === "stdio") {
    // The stdio transport serves exactly one MCP client per process
    // (typically a desktop app) and has no per-request Authorization header
    // to fall back on, so REDASH_API_KEY must be a valid static credential
    // known at startup. RedashClient itself only requires REDASH_API_KEY
    // lazily (per outgoing request, see requestAuth.ts) to support HTTP
    // transport's per-request tokens, so check it explicitly here to keep
    // stdio's original fail-fast behavior.
    if (!process.env.REDASH_API_KEY) {
      throw new Error(
        "REDASH_API_KEY must be provided in .env file (required for the stdio transport)."
      );
    }

    const { startStdioServer } = await import("./index.js");
    return await startStdioServer();
  }

  // In HTTP transport mode, each incoming request is expected to carry its
  // own personal Redash API token in its `Authorization` header (see
  // README's "Streamable HTTP Transport" section), so REDASH_API_KEY is
  // optional here - it only serves as a fallback for requests that don't
  // send one.
  if (!process.env.REDASH_API_KEY) {
    logger.warning(
      "REDASH_API_KEY is not set. Running in HTTP transport mode without a static " +
      "fallback key - every incoming MCP request must supply its own Redash API token via " +
      "the `Authorization` header, or it will be rejected."
    );
  }

  const { startHttpServer } = await import("./httpServer.js");
  return await startHttpServer(config.http);
}

export function registerGracefulShutdown(
  handle: ServerHandle,
  target: ShutdownSignalTarget = process,
): GracefulShutdownController {
  let shutdownPromise: Promise<void> | undefined;

  const listeners = new Map(
    SHUTDOWN_SIGNALS.map((signal) => [signal, () => void shutdown(signal)] as const),
  );
  const shutdown = (signal: ShutdownSignal): Promise<void> => {
    shutdownPromise ??= (async () => {
      for (const [name, listener] of listeners) {
        target.off(name, listener);
      }

      logger.info(`Received ${signal}; shutting down...`);

      try {
        await handle.close();
        target.exitCode ??= 0;
        logger.info("Redash MCP server shut down cleanly.");
      } catch (error) {
        target.exitCode = 1;
        logger.error(`Failed to shut down cleanly: ${formatError(error)}`, undefined, error);
      } finally {
        await shutdownTelemetry();
      }
    })();

    return shutdownPromise;
  };

  for (const [signal, listener] of listeners) {
    target.once(signal, listener);
  }

  return { shutdown };
}

export async function runConfiguredServerCli(): Promise<void> {
  try {
    const config = parseServerConfig();
    await initializeTelemetry({
      transport: config.transport,
      ...(config.transport === "http" ? { httpPath: config.http.path } : {}),
    });
    const handle = await startConfiguredServer(config);

    registerGracefulShutdown(handle);
  } catch (error) {
    logger.error(`Error: ${formatError(error)}`, undefined, error);
    process.exitCode = 1;
    await shutdownTelemetry();
  }
}
