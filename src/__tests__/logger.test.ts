import { jest } from "@jest/globals";
import { logs } from "@opentelemetry/api-logs";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { Logger, LogLevel } from "../logger.js";

const logExporter = new InMemoryLogRecordExporter();
const loggerProvider = new LoggerProvider({
  processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
});

describe("Logger", () => {
  let logger: Logger;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeAll(() => {
    logs.setGlobalLoggerProvider(loggerProvider);
  });

  beforeEach(() => {
    logExporter.reset();
    logger = new Logger();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  afterAll(async () => {
    await loggerProvider.shutdown();
  });

  it.each([
    [LogLevel.DEBUG, "Debug message"],
    [LogLevel.INFO, "Info message"],
    [LogLevel.NOTICE, "Notice message"],
    [LogLevel.WARNING, "Warning message"],
    [LogLevel.ERROR, "Error message"],
    [LogLevel.CRITICAL, "Critical message"],
    [LogLevel.ALERT, "Alert message"],
    [LogLevel.EMERGENCY, "Emergency message"],
  ])("writes %s logs to stderr", (level, message) => {
    logger.log(level, message);

    expect(consoleErrorSpy).toHaveBeenCalledWith(`[${level.toUpperCase()}] ${message}`);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("exports structured attributes and an exception without adding them to stderr", async () => {
    const error = new Error("upstream unavailable");
    expect(() => {
      logger.error(
        "Redash request failed",
        { "http.response.status_code": 503, retryable: true },
        error,
      );
    }).not.toThrow();
    await loggerProvider.forceFlush();

    expect(consoleErrorSpy).toHaveBeenCalledWith("[ERROR] Redash request failed");
    expect(logExporter.getFinishedLogRecords()).toHaveLength(1);
    const record = logExporter.getFinishedLogRecords()[0];
    expect(record.body).toBe("Redash request failed");
    expect(record.severityText).toBe("ERROR");
    expect(record.attributes).toMatchObject({
      "http.response.status_code": 503,
      retryable: true,
      "exception.type": "Error",
      "exception.message": "upstream unavailable",
    });
  });

  it("normalizes circular, shared, and deeply nested fields without throwing", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const shared = { value: 42 };
    const deeplyNested = { next: { next: { next: { next: { next: { value: "hidden" } } } } } };

    expect(() => {
      logger.info("Structured fields", {
        circular,
        first: shared,
        second: shared,
        deeplyNested,
      });
    }).not.toThrow();
    await loggerProvider.forceFlush();

    expect(logExporter.getFinishedLogRecords()[0].attributes).toMatchObject({
      circular: { self: "[Circular]" },
      first: { value: 42 },
      second: { value: 42 },
      deeplyNested: {
        next: { next: { next: { next: { next: "[MaxDepth]" } } } },
      },
    });
  });

  it("keeps the convenience methods mapped to their expected levels", () => {
    logger.debug("debug");
    logger.info("info");
    logger.warning("warning");
    logger.error("error");

    expect(consoleErrorSpy.mock.calls.map(([message]) => message)).toEqual([
      "[DEBUG] debug",
      "[INFO] info",
      "[WARNING] warning",
      "[ERROR] error",
    ]);
  });

  it("sends stdio MCP log notifications and detaches cleanly", async () => {
    const sendLoggingMessage = jest.fn(async () => {});
    logger.setServer({ sendLoggingMessage });

    logger.warning("Client-visible warning", { internal: "not-sent" });
    await Promise.resolve();

    expect(sendLoggingMessage).toHaveBeenCalledWith({
      level: LogLevel.WARNING,
      data: "Client-visible warning",
    });

    logger.setServer(null);
    logger.info("Detached");
    expect(sendLoggingMessage).toHaveBeenCalledTimes(1);
  });

  it.each(["async", "sync"] as const)(
    "does not throw when an MCP log notification fails %s",
    async (failureMode) => {
      const failure = new Error("client disconnected");
      logger.setServer({
        sendLoggingMessage: failureMode === "async"
          ? jest.fn(async () => { throw failure; })
          : jest.fn(() => { throw failure; }),
      });

      expect(() => logger.error("Still logged")).not.toThrow();
      await Promise.resolve();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send log notification: client disconnected",
      );
    },
  );
});
