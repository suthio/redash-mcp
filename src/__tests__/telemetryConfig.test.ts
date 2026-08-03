import { resolveTelemetryConfig } from "../telemetryConfig.js";

describe("resolveTelemetryConfig", () => {
  it("does not create an exporter when no telemetry setting is present", () => {
    const config = resolveTelemetryConfig({ env: {}, transport: "stdio" });

    expect(config.enabled).toBe(false);
    expect(config.traces.enabled).toBe(false);
    expect(config.metrics.otlpEnabled).toBe(false);
    expect(config.logs.enabled).toBe(false);
  });

  it("enables all OTLP signals from the shared endpoint", () => {
    const config = resolveTelemetryConfig({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318" },
      transport: "http",
    });

    expect(config.traces.enabled).toBe(true);
    expect(config.metrics.otlpEnabled).toBe(true);
    expect(config.logs.enabled).toBe(true);
    expect(config.traces.protocol).toBe("http/protobuf");
  });

  it("honors explicit per-signal exporters and protocols", () => {
    const config = resolveTelemetryConfig({
      env: {
        OTEL_TRACES_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "none",
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "grpc",
        OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/json",
      },
      transport: "stdio",
    });

    expect(config.traces).toEqual({ enabled: true, protocol: "grpc" });
    expect(config.metrics.otlpEnabled).toBe(false);
    expect(config.logs).toEqual({ enabled: true, protocol: "http/json" });
  });

  it("disables only the signal with an invalid protocol", () => {
    const config = resolveTelemetryConfig({
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318",
        OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "invalid",
      },
      transport: "http",
    });

    expect(config.traces.enabled).toBe(true);
    expect(config.metrics.otlpEnabled).toBe(false);
    expect(config.logs.enabled).toBe(true);
    expect(config.warnings).toContainEqual(expect.stringContaining("disabling OTLP metrics"));
  });

  it("mounts Prometheus on the HTTP listener by default", () => {
    const config = resolveTelemetryConfig({
      env: { OTEL_METRICS_EXPORTER: "prometheus" },
      transport: "http",
    });

    expect(config.metrics.prometheus).toEqual({
      enabled: true,
      mode: "embedded",
      path: "/metrics",
    });
  });

  it("requires a separate Prometheus listener for stdio", () => {
    const config = resolveTelemetryConfig({
      env: { OTEL_METRICS_EXPORTER: "prometheus" },
      transport: "stdio",
    });

    expect(config.enabled).toBe(false);
    expect(config.metrics.prometheus.enabled).toBe(false);
    expect(config.warnings).toContainEqual(expect.stringContaining("when using stdio"));
  });

  it("configures a separate Prometheus listener for either transport", () => {
    const config = resolveTelemetryConfig({
      env: {
        OTEL_METRICS_EXPORTER: "otlp,prometheus",
        OTEL_EXPORTER_PROMETHEUS_HOST: "0.0.0.0",
        OTEL_EXPORTER_PROMETHEUS_PORT: "9465",
      },
      transport: "stdio",
    });

    expect(config.metrics.otlpEnabled).toBe(true);
    expect(config.metrics.prometheus).toEqual({
      enabled: true,
      mode: "standalone",
      host: "0.0.0.0",
      port: 9465,
      path: "/metrics",
    });
  });

  it('disables a signal when "none" is combined with another exporter', () => {
    const config = resolveTelemetryConfig({
      env: { OTEL_TRACES_EXPORTER: "otlp,none" },
      transport: "http",
    });

    expect(config.traces.enabled).toBe(false);
    expect(config.warnings).toContainEqual(expect.stringContaining("disabling traces"));
  });

  it("warns about unsupported exporters", () => {
    const config = resolveTelemetryConfig({
      env: { OTEL_TRACES_EXPORTER: "console" },
      transport: "http",
    });

    expect(config.traces.enabled).toBe(false);
    expect(config.warnings).toContainEqual(expect.stringContaining('Unsupported traces exporter "console"'));
  });

  it("disables Prometheus when its listener port is invalid", () => {
    const config = resolveTelemetryConfig({
      env: {
        OTEL_METRICS_EXPORTER: "prometheus",
        OTEL_EXPORTER_PROMETHEUS_PORT: "70000",
      },
      transport: "stdio",
    });

    expect(config.metrics.prometheus.enabled).toBe(false);
    expect(config.warnings).toContainEqual(
      expect.stringContaining("Invalid OTEL_EXPORTER_PROMETHEUS_PORT"),
    );
  });

  it("keeps tool arguments and results disabled unless explicitly requested", () => {
    expect(resolveTelemetryConfig({ env: {} }).captureToolContent).toBe(false);
    expect(resolveTelemetryConfig({
      env: { OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true" },
    }).captureToolContent).toBe(true);
  });

  it("lets OTEL_SDK_DISABLED override every exporter setting", () => {
    const config = resolveTelemetryConfig({
      env: {
        OTEL_SDK_DISABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318",
        OTEL_METRICS_EXPORTER: "otlp,prometheus",
      },
      transport: "http",
    });

    expect(config.sdkDisabled).toBe(true);
    expect(config.enabled).toBe(false);
  });
});
