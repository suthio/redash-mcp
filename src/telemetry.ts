import type { ClientRequest, IncomingMessage, ServerResponse } from "node:http";
import { DiagLogLevel, diag, type DiagLogger } from "@opentelemetry/api";
import { OTLPLogExporter as GrpcLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPLogExporter as JsonLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPLogExporter as ProtobufLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter as GrpcMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPMetricExporter as JsonMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPMetricExporter as ProtobufMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter as GrpcTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as JsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as ProtobufTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HostMetrics } from "@opentelemetry/host-metrics";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import {
  detectResources,
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  resourceFromAttributes,
  serviceInstanceIdDetector,
  type Resource,
} from "@opentelemetry/resources";
import { BatchLogRecordProcessor, type LogRecordExporter } from "@opentelemetry/sdk-logs";
import {
  AggregationType,
  PeriodicExportingMetricReader,
  type IMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { ServerTransport } from "./config.js";
import {
  METRIC_MCP_SERVER_OPERATION_DURATION,
  METRIC_MCP_SERVER_SESSION_DURATION,
} from "@opentelemetry/semantic-conventions/incubating";
import {
  resolveTelemetryConfig,
  type OtlpProtocol,
  type ResolvedTelemetryConfig,
} from "./telemetryConfig.js";
import { PACKAGE_VERSION } from "./packageInfo.js";

const SERVICE_NAME = "redash-mcp";
const MCP_DURATION_BUCKETS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

export interface InitializeTelemetryOptions {
  transport?: ServerTransport;
  httpPath?: string;
}

let sdk: NodeSDK | undefined;
let initializationPromise: Promise<void> | undefined;
let shutdownPromise: Promise<void> | undefined;
let prometheusExporter: PrometheusExporter | undefined;
let embeddedPrometheusEnabled = false;
let activeConfig: ResolvedTelemetryConfig | undefined;

export function initializeTelemetry(options: InitializeTelemetryOptions = {}): Promise<void> {
  initializationPromise ??= initializeTelemetryRuntime(options).catch(async (error) => {
    telemetryWarning(
      `OpenTelemetry initialization failed; continuing without telemetry: ${formatUnknownError(error)}`,
    );
    await resetFailedTelemetryRuntime();
  });
  return initializationPromise;
}

export function shutdownTelemetry(): Promise<void> {
  shutdownPromise ??= shutdownTelemetryRuntime();
  return shutdownPromise;
}

export function hasEmbeddedPrometheusMetrics(): boolean {
  return embeddedPrometheusEnabled && prometheusExporter !== undefined;
}

export function disableEmbeddedPrometheusMetrics(reason: string): void {
  if (!embeddedPrometheusEnabled) {
    return;
  }
  embeddedPrometheusEnabled = false;
  telemetryWarning(reason);
}

export function handlePrometheusMetricsRequest(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (!hasEmbeddedPrometheusMetrics()) {
    return false;
  }

  prometheusExporter!.getMetricsRequestHandler(request, response);
  return true;
}

export function isToolContentCaptureEnabled(): boolean {
  return activeConfig?.captureToolContent ?? false;
}

async function initializeTelemetryRuntime(options: InitializeTelemetryOptions): Promise<void> {
  const config = resolveTelemetryConfig({ transport: options.transport });
  const mcpHttpPath = options.transport === "http"
    ? resolveMcpHttpPath(options.httpPath)
    : undefined;
  activeConfig = config;
  for (const warning of config.warnings) {
    telemetryWarning(warning);
  }

  if (!config.enabled) {
    return;
  }

  const spanProcessors = createSpanProcessors(config);
  const metricReaders = createMetricReaders(config);
  const logRecordProcessors = createLogRecordProcessors(config);
  const instrumentations: Instrumentation[] = [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) => {
        return requestPath(request.url) === "/metrics" && mcpHttpPath !== "/metrics";
      },
      requestHook: (span, request) => {
        if (!mcpHttpPath || !isIncomingRequest(request) || requestPath(request.url) !== mcpHttpPath) {
          return;
        }
        span.setAttribute(ATTR_HTTP_ROUTE, mcpHttpPath);
        if (request.method) {
          span.updateName(`${request.method.toUpperCase()} ${mcpHttpPath}`);
        }
      },
    }),
  ];

  if (metricReaders.length > 0) {
    instrumentations.push(new RuntimeNodeInstrumentation({ captureUncaughtException: false }));
  }

  const resource = await createResource();

  try {
    const configuredLogLevel = process.env.OTEL_LOG_LEVEL;
    delete process.env.OTEL_LOG_LEVEL;
    try {
      sdk = new NodeSDK({
        resource,
        autoDetectResources: false,
        spanProcessors,
        metricReaders,
        logRecordProcessors,
        instrumentations,
        views: [
          {
            instrumentName: METRIC_MCP_SERVER_OPERATION_DURATION,
            aggregation: {
              type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
              options: { boundaries: MCP_DURATION_BUCKETS },
            },
          },
          {
            instrumentName: METRIC_MCP_SERVER_SESSION_DURATION,
            aggregation: {
              type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
              options: { boundaries: MCP_DURATION_BUCKETS },
            },
          },
        ],
      });
    } finally {
      if (configuredLogLevel === undefined) {
        delete process.env.OTEL_LOG_LEVEL;
      } else {
        process.env.OTEL_LOG_LEVEL = configuredLogLevel;
      }
    }

    diag.setLogger(new StderrDiagLogger(), {
      logLevel: parseDiagLogLevel(configuredLogLevel),
      suppressOverrideMessage: true,
    });
    sdk.start();

    if (metricReaders.length > 0) {
      new HostMetrics({ name: SERVICE_NAME }).start();
    }

    if (config.metrics.prometheus.mode === "standalone" && prometheusExporter) {
      try {
        await prometheusExporter.startServer();
      } catch (error) {
        telemetryWarning(`Failed to start the Prometheus metrics listener: ${formatUnknownError(error)}`);
      }
    }
  } catch (error) {
    telemetryWarning(`OpenTelemetry initialization failed; continuing without telemetry: ${formatUnknownError(error)}`);
    await resetFailedTelemetryRuntime();
  }
}

function resolveMcpHttpPath(value: string | undefined): string {
  const path = value?.trim() || "/mcp";
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    telemetryWarning(`Ignoring invalid telemetry HTTP path "${path}"; using "/mcp".`);
    return "/mcp";
  }
  return path;
}

function isIncomingRequest(request: ClientRequest | IncomingMessage): request is IncomingMessage {
  return "url" in request && typeof request.url === "string";
}

function requestPath(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

async function resetFailedTelemetryRuntime(): Promise<void> {
  try {
    await sdk?.shutdown();
  } catch {
    // Initialization already failed; the original diagnostic is more useful.
  }
  sdk = undefined;
  prometheusExporter = undefined;
  embeddedPrometheusEnabled = false;
}

async function createResource(): Promise<Resource> {
  const detected = detectResources({
    detectors: [
      envDetector,
      processDetector,
      hostDetector,
      osDetector,
      serviceInstanceIdDetector,
    ],
  });
  await detected.waitForAsyncAttributes?.();

  return detected.merge(resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME?.trim()
      || detected.attributes[ATTR_SERVICE_NAME]
      || SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: detected.attributes[ATTR_SERVICE_VERSION]
      || PACKAGE_VERSION,
  }));
}

async function shutdownTelemetryRuntime(): Promise<void> {
  await initializationPromise;
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } catch (error) {
    telemetryWarning(`OpenTelemetry shutdown failed: ${formatUnknownError(error)}`);
  }
}

function createSpanProcessors(config: ResolvedTelemetryConfig) {
  if (!config.traces.enabled) {
    return [];
  }

  try {
    return [new BatchSpanProcessor(createTraceExporter(config.traces.protocol))];
  } catch (error) {
    telemetryWarning(`Failed to configure trace export; disabling traces: ${formatUnknownError(error)}`);
    return [];
  }
}

function createMetricReaders(config: ResolvedTelemetryConfig): IMetricReader[] {
  const readers: IMetricReader[] = [];
  if (config.metrics.otlpEnabled) {
    try {
      readers.push(new PeriodicExportingMetricReader({
        exporter: createMetricExporter(config.metrics.protocol),
        exportIntervalMillis: readPositiveInteger("OTEL_METRIC_EXPORT_INTERVAL"),
        exportTimeoutMillis: readPositiveInteger("OTEL_METRIC_EXPORT_TIMEOUT"),
      }));
    } catch (error) {
      telemetryWarning(`Failed to configure metric export; disabling OTLP metrics: ${formatUnknownError(error)}`);
    }
  }

  const prometheus = config.metrics.prometheus;
  if (prometheus.enabled) {
    try {
      prometheusExporter = new PrometheusExporter({
        preventServerStart: true,
        endpoint: prometheus.path,
        ...(prometheus.mode === "standalone" ? {
          host: prometheus.host,
          port: prometheus.port,
        } : {}),
      });
      readers.push(prometheusExporter);
      embeddedPrometheusEnabled = prometheus.mode === "embedded";
    } catch (error) {
      telemetryWarning(`Failed to configure Prometheus metrics; disabling Prometheus: ${formatUnknownError(error)}`);
      prometheusExporter = undefined;
    }
  }

  return readers;
}

function createLogRecordProcessors(config: ResolvedTelemetryConfig) {
  if (!config.logs.enabled) {
    return [];
  }

  try {
    return [new BatchLogRecordProcessor({
      exporter: createLogExporter(config.logs.protocol),
      maxQueueSize: readPositiveInteger("OTEL_BLRP_MAX_QUEUE_SIZE"),
      maxExportBatchSize: readPositiveInteger("OTEL_BLRP_MAX_EXPORT_BATCH_SIZE"),
      scheduledDelayMillis: readPositiveInteger("OTEL_BLRP_SCHEDULE_DELAY"),
      exportTimeoutMillis: readPositiveInteger("OTEL_BLRP_EXPORT_TIMEOUT"),
    })];
  } catch (error) {
    telemetryWarning(`Failed to configure log export; disabling OTLP logs: ${formatUnknownError(error)}`);
    return [];
  }
}

function createTraceExporter(protocol: OtlpProtocol): SpanExporter {
  if (protocol === "grpc") return new GrpcTraceExporter();
  if (protocol === "http/json") return new JsonTraceExporter();
  return new ProtobufTraceExporter();
}

function createMetricExporter(protocol: OtlpProtocol): PushMetricExporter {
  if (protocol === "grpc") return new GrpcMetricExporter();
  if (protocol === "http/json") return new JsonMetricExporter();
  return new ProtobufMetricExporter();
}

function createLogExporter(protocol: OtlpProtocol): LogRecordExporter {
  if (protocol === "grpc") return new GrpcLogExporter();
  if (protocol === "http/json") return new JsonLogExporter();
  return new ProtobufLogExporter();
}

function readPositiveInteger(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    telemetryWarning(`Ignoring invalid ${name} value "${value}"; expected a positive integer.`);
    return undefined;
  }
  return number;
}

class StderrDiagLogger implements DiagLogger {
  error(message: string, ...args: unknown[]): void {
    writeDiag("ERROR", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    writeDiag("WARN", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    writeDiag("INFO", message, args);
  }

  debug(message: string, ...args: unknown[]): void {
    writeDiag("DEBUG", message, args);
  }

  verbose(message: string, ...args: unknown[]): void {
    writeDiag("VERBOSE", message, args);
  }
}

function parseDiagLogLevel(value: string | undefined): DiagLogLevel {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized in DiagLogLevel
    ? DiagLogLevel[normalized as keyof typeof DiagLogLevel]
    : DiagLogLevel.WARN;
}

function writeDiag(level: string, message: string, args: unknown[]): void {
  const suffix = args.length > 0 ? ` ${args.map(formatUnknownError).join(" ")}` : "";
  process.stderr.write(`[OTEL ${level}] ${message}${suffix}\n`);
}

function telemetryWarning(message: string): void {
  process.stderr.write(`[OTEL WARN] ${message}\n`);
}

function formatUnknownError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
