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
  exitCode?: number | string | null;
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
    const { startStdioServer } = await import("./index.js");
    return await startStdioServer();
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
