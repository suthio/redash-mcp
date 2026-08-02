import { parseServerConfig, type ServerConfig } from "./config.js";
import { startHttpServer } from "./httpServer.js";
import { startStdioServer } from "./index.js";
import { logger } from "./logger.js";
import { getRedashClient } from "./redashClient.js";
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
  // not on the first tool call.
  getRedashClient();

  if (config.transport === "stdio") {
    return await startStdioServer();
  }

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
        // The MCP channel is gone; keep the remaining messages on stderr only.
        logger.setServer(null);
        target.exitCode ??= 0;
        logger.info("Redash MCP server shut down cleanly.");
      } catch (error) {
        logger.setServer(null);
        target.exitCode = 1;
        logger.error(`Failed to shut down cleanly: ${formatError(error)}`);
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
    const handle = await startConfiguredServer(parseServerConfig());

    registerGracefulShutdown(handle);
  } catch (error) {
    console.error(`Error: ${formatError(error)}`);
    process.exit(1);
  }
}
