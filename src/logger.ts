// Custom logger for the Redash MCP server

/**
 * Log levels supported by MCP
 */
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  NOTICE = "notice",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
  ALERT = "alert",
  EMERGENCY = "emergency"
}

interface LoggingServer {
  sendLoggingMessage(params: { level: LogLevel; data: string }): Promise<void>;
}

/**
 * Logger class that outputs to both console and can send notifications to clients
 */
export class Logger {
  private server: LoggingServer | null = null;

  /**
   * Sets the MCP server instance to enable sending log notifications;
   * pass null to detach a closed server and log to stderr only.
   */
  setServer(server: LoggingServer | null): void {
    this.server = server;
  }

  /**
   * Log a debug message
   */
  debug(message: string): void {
    this.log(LogLevel.DEBUG, message);
  }

  /**
   * Log an info message
   */
  info(message: string): void {
    this.log(LogLevel.INFO, message);
  }

  /**
   * Log a warning message
   */
  warning(message: string): void {
    this.log(LogLevel.WARNING, message);
  }

  /**
   * Log an error message
   */
  error(message: string): void {
    this.log(LogLevel.ERROR, message);
  }

  /**
   * Log a message with the specified level
   */
  log(level: LogLevel, message: string): void {
    // Always output to stderr for local debugging
    console.error(`[${level.toUpperCase()}] ${message}`);

    if (this.server) {
      const reportSendFailure = (err: unknown) => {
        console.error(`Failed to send log notification: ${err}`);
      };

      try {
        void this.server.sendLoggingMessage({
          level,
          data: message,
        }).catch(reportSendFailure);
      } catch (err) {
        reportSendFailure(err);
      }
    }
  }
}

// Export a singleton instance
export const logger = new Logger();
