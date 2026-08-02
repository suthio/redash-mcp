import type { ServerTransport } from "./config.js";

export type OtlpProtocol = "grpc" | "http/protobuf" | "http/json";

export interface PrometheusTelemetryConfig {
  enabled: boolean;
  mode?: "embedded" | "standalone";
  host?: string;
  port?: number;
  path: "/metrics";
}

export interface ResolvedTelemetryConfig {
  enabled: boolean;
  sdkDisabled: boolean;
  captureToolContent: boolean;
  traces: {
    enabled: boolean;
    protocol: OtlpProtocol;
  };
  metrics: {
    otlpEnabled: boolean;
    protocol: OtlpProtocol;
    prometheus: PrometheusTelemetryConfig;
  };
  logs: {
    enabled: boolean;
    protocol: OtlpProtocol;
  };
  warnings: string[];
}

export interface ResolveTelemetryConfigOptions {
  env?: NodeJS.ProcessEnv;
  transport?: ServerTransport;
}

const DEFAULT_OTLP_PROTOCOL: OtlpProtocol = "http/protobuf";
const DEFAULT_PROMETHEUS_HOST = "127.0.0.1";
const DEFAULT_PROMETHEUS_PORT = 9464;

export function resolveTelemetryConfig(
  options: ResolveTelemetryConfigOptions = {},
): ResolvedTelemetryConfig {
  const env = options.env ?? process.env;
  const transport = options.transport ?? "stdio";
  const warnings: string[] = [];
  const sdkDisabled = parseBoolean(env.OTEL_SDK_DISABLED);

  if (sdkDisabled) {
    return disabledTelemetryConfig(true);
  }

  const hasGenericEndpoint = hasValue(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const tracesExporters = parseExporterList(env.OTEL_TRACES_EXPORTER);
  const metricsExporters = parseExporterList(env.OTEL_METRICS_EXPORTER);
  const logsExporters = parseExporterList(env.OTEL_LOGS_EXPORTER);

  const tracesRequested = resolveOtlpExporter({
    signal: "traces",
    exporters: tracesExporters,
    endpointConfigured: hasGenericEndpoint || hasValue(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT),
    warnings,
  });
  const metricsOtlpRequested = resolveOtlpExporter({
    signal: "metrics",
    exporters: metricsExporters,
    endpointConfigured: hasGenericEndpoint || hasValue(env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT),
    warnings,
    allowedExtraExporter: "prometheus",
  });
  const logsRequested = resolveOtlpExporter({
    signal: "logs",
    exporters: logsExporters,
    endpointConfigured: hasGenericEndpoint || hasValue(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT),
    warnings,
  });

  const tracesProtocol = resolveProtocol(
    "traces",
    env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL,
    tracesRequested,
    warnings,
  );
  const metricsProtocol = resolveProtocol(
    "metrics",
    env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL,
    metricsOtlpRequested,
    warnings,
  );
  const logsProtocol = resolveProtocol(
    "logs",
    env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL,
    logsRequested,
    warnings,
  );

  const prometheusRequested = !metricsExporters.includes("none")
    && metricsExporters.includes("prometheus");
  const prometheus = resolvePrometheusConfig({
    env,
    requested: prometheusRequested,
    transport,
    warnings,
  });

  const tracesEnabled = tracesRequested && tracesProtocol !== undefined;
  const metricsOtlpEnabled = metricsOtlpRequested && metricsProtocol !== undefined;
  const logsEnabled = logsRequested && logsProtocol !== undefined;

  return {
    enabled: tracesEnabled || metricsOtlpEnabled || logsEnabled || prometheus.enabled,
    sdkDisabled: false,
    captureToolContent: parseBoolean(env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT),
    traces: {
      enabled: tracesEnabled,
      protocol: tracesProtocol ?? DEFAULT_OTLP_PROTOCOL,
    },
    metrics: {
      otlpEnabled: metricsOtlpEnabled,
      protocol: metricsProtocol ?? DEFAULT_OTLP_PROTOCOL,
      prometheus,
    },
    logs: {
      enabled: logsEnabled,
      protocol: logsProtocol ?? DEFAULT_OTLP_PROTOCOL,
    },
    warnings,
  };
}

function disabledTelemetryConfig(sdkDisabled: boolean): ResolvedTelemetryConfig {
  return {
    enabled: false,
    sdkDisabled,
    captureToolContent: false,
    traces: { enabled: false, protocol: DEFAULT_OTLP_PROTOCOL },
    metrics: {
      otlpEnabled: false,
      protocol: DEFAULT_OTLP_PROTOCOL,
      prometheus: { enabled: false, path: "/metrics" },
    },
    logs: { enabled: false, protocol: DEFAULT_OTLP_PROTOCOL },
    warnings: [],
  };
}

interface ResolveOtlpExporterOptions {
  signal: "traces" | "metrics" | "logs";
  exporters: string[];
  endpointConfigured: boolean;
  warnings: string[];
  allowedExtraExporter?: "prometheus";
}

function resolveOtlpExporter(options: ResolveOtlpExporterOptions): boolean {
  const { signal, exporters, endpointConfigured, warnings, allowedExtraExporter } = options;
  if (exporters.includes("none")) {
    if (exporters.length > 1) {
      warnings.push(`OTEL_${signal.toUpperCase()}_EXPORTER contains "none" with other exporters; disabling ${signal}.`);
    }
    return false;
  }

  const allowed = new Set(["otlp", ...(allowedExtraExporter ? [allowedExtraExporter] : [])]);
  for (const exporter of exporters) {
    if (!allowed.has(exporter)) {
      warnings.push(`Unsupported ${signal} exporter "${exporter}"; supported values are ${[...allowed, "none"].join(", ")}.`);
    }
  }

  if (exporters.length > 0) {
    return exporters.includes("otlp");
  }

  return endpointConfigured;
}

function resolveProtocol(
  signal: "traces" | "metrics" | "logs",
  value: string | undefined,
  requested: boolean,
  warnings: string[],
): OtlpProtocol | undefined {
  if (!requested || !hasValue(value)) {
    return requested ? DEFAULT_OTLP_PROTOCOL : undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "grpc" || normalized === "http/protobuf" || normalized === "http/json") {
    return normalized;
  }

  warnings.push(
    `Unsupported OTLP ${signal} protocol "${value}"; disabling OTLP ${signal}. Expected grpc, http/protobuf, or http/json.`,
  );
  return undefined;
}

interface ResolvePrometheusOptions {
  env: NodeJS.ProcessEnv;
  requested: boolean;
  transport: ServerTransport;
  warnings: string[];
}

function resolvePrometheusConfig(options: ResolvePrometheusOptions): PrometheusTelemetryConfig {
  const base: PrometheusTelemetryConfig = { enabled: false, path: "/metrics" };
  if (!options.requested) {
    return base;
  }

  const separateListener = hasValue(options.env.OTEL_EXPORTER_PROMETHEUS_HOST)
    || hasValue(options.env.OTEL_EXPORTER_PROMETHEUS_PORT);
  if (!separateListener) {
    if (options.transport === "http") {
      return { enabled: true, mode: "embedded", path: "/metrics" };
    }

    options.warnings.push(
      "Prometheus metrics require OTEL_EXPORTER_PROMETHEUS_HOST or OTEL_EXPORTER_PROMETHEUS_PORT when using stdio; disabling Prometheus export.",
    );
    return base;
  }

  const port = parsePort(options.env.OTEL_EXPORTER_PROMETHEUS_PORT);
  if (port === undefined) {
    options.warnings.push(
      `Invalid OTEL_EXPORTER_PROMETHEUS_PORT "${options.env.OTEL_EXPORTER_PROMETHEUS_PORT}"; disabling Prometheus export.`,
    );
    return base;
  }

  return {
    enabled: true,
    mode: "standalone",
    host: options.env.OTEL_EXPORTER_PROMETHEUS_HOST?.trim() || DEFAULT_PROMETHEUS_HOST,
    port,
    path: "/metrics",
  };
}

function parseExporterList(value: string | undefined): string[] {
  if (!hasValue(value)) {
    return [];
  }

  return [...new Set(value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

function parsePort(value: string | undefined): number | undefined {
  if (!hasValue(value)) {
    return DEFAULT_PROMETHEUS_PORT;
  }

  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}
