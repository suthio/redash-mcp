import {
  SpanKind,
  SpanStatusCode,
  context,
  metrics,
  propagation,
  trace,
  type Attributes,
  type Context,
  type Link,
  type Span,
} from "@opentelemetry/api";
import {
  McpServer,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type MessageExtraInfo,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import { ATTR_NETWORK_PROTOCOL_NAME } from "@opentelemetry/semantic-conventions";
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROMPT_NAME,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_JSONRPC_REQUEST_ID,
  ATTR_MCP_METHOD_NAME,
  ATTR_MCP_PROTOCOL_VERSION,
  ATTR_MCP_RESOURCE_URI,
  ATTR_MCP_SESSION_ID,
  ATTR_RPC_RESPONSE_STATUS_CODE,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
  METRIC_MCP_SERVER_OPERATION_DURATION,
  METRIC_MCP_SERVER_SESSION_DURATION,
} from "@opentelemetry/semantic-conventions/incubating";
import { isToolContentCaptureEnabled } from "./telemetry.js";

const INSTRUMENTATION_NAME = "@suthio/redash-mcp";
const tracer = trace.getTracer(INSTRUMENTATION_NAME);
const meter = metrics.getMeter(INSTRUMENTATION_NAME);
const operationDuration = meter.createHistogram(METRIC_MCP_SERVER_OPERATION_DURATION, {
  description: "Duration of an MCP request or notification handled by the server.",
  unit: "s",
});
const sessionDuration = meter.createHistogram(METRIC_MCP_SERVER_SESSION_DURATION, {
  description: "Duration of an MCP server transport session.",
  unit: "s",
});

export interface McpTelemetryOptions {
  networkTransport: "pipe" | "tcp";
  networkProtocolName?: "http";
  recordSession?: boolean;
}

interface PendingOperation {
  span: Span;
  startedAt: bigint;
  metricAttributes: Attributes;
  method: string;
}

/**
 * McpServer variant that instruments the transport boundary. Keeping the
 * instrumentation at this boundary covers every registered tool/resource as
 * well as protocol operations implemented by the SDK itself.
 */
export class TelemetryMcpServer extends McpServer {
  constructor(
    serverInfo: ConstructorParameters<typeof McpServer>[0],
    serverOptions: ConstructorParameters<typeof McpServer>[1],
    private readonly telemetryOptions: McpTelemetryOptions,
  ) {
    super(serverInfo, serverOptions);
  }

  override connect(transport: Transport): Promise<void> {
    return super.connect(new InstrumentedTransport(transport, this.telemetryOptions));
  }
}

class InstrumentedTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  private readonly pending = new Map<string, PendingOperation>();
  private readonly connectedAt = process.hrtime.bigint();
  private readonly connectionContext: Context;
  private protocolVersion: string | undefined;
  private sessionErrorType: string | undefined;
  private sessionEnded = false;

  constructor(
    private readonly delegate: Transport,
    private readonly options: McpTelemetryOptions,
  ) {
    this.connectionContext = context.active();

    delegate.onmessage = (message, extra) => this.receive(message, extra);
    delegate.onerror = (error) => {
      this.sessionErrorType ??= errorName(error);
      this.onerror?.(error);
    };
    delegate.onclose = () => {
      this.onclose?.();
      // Stateless HTTP transports schedule close before the Promise returned
      // by send() resumes. Defer telemetry cleanup once so the response can
      // finish its matching operation as success/error instead of being
      // misclassified as connection_closed.
      queueMicrotask(() => {
        this.finishAllPending("connection_closed");
        this.finishSession();
      });
    };
  }

  get sessionId(): string | undefined {
    return this.delegate.sessionId;
  }

  get hasPerRequestStream(): boolean | undefined {
    return this.delegate.hasPerRequestStream;
  }

  start(): Promise<void> {
    return this.delegate.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    try {
      await this.delegate.send(message, options);
    } catch (error) {
      const id = responseId(message);
      if (id !== undefined) {
        this.finishPending(id, message, error);
      }
      throw error;
    }

    const id = responseId(message);
    if (id !== undefined) {
      this.finishPending(id, message);
    }
  }

  async close(): Promise<void> {
    try {
      await this.delegate.close();
    } finally {
      this.finishAllPending("connection_closed");
      this.finishSession();
    }
  }

  setProtocolVersion = (version: string): void => {
    this.protocolVersion = version;
    for (const operation of this.pending.values()) {
      operation.span.setAttribute(ATTR_MCP_PROTOCOL_VERSION, version);
      operation.metricAttributes[ATTR_MCP_PROTOCOL_VERSION] = version;
    }
    this.delegate.setProtocolVersion?.(version);
  };

  setSupportedProtocolVersions = (versions: string[]): void => {
    this.delegate.setSupportedProtocolVersions?.(versions);
  };

  private receive<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo): void {
    if (!isJSONRPCRequest(message) && !isJSONRPCNotification(message)) {
      this.onmessage?.(message, extra);
      return;
    }

    if (message.method === "notifications/cancelled") {
      const cancelledId = readCancelledRequestId(message);
      if (cancelledId !== undefined) {
        this.finishPending(cancelledId, undefined, undefined, "cancelled");
      }
    }

    const protocolVersion = resolveProtocolVersion(message, extra, this.protocolVersion);
    const attributes = operationAttributes(message, protocolVersion, this.options, this.sessionId);
    const metricAttributes = metricOperationAttributes(message, protocolVersion, this.options);
    const parent = extractParentContext(message, context.active(), this.connectionContext);
    const spanName = operationSpanName(message);
    const startedAt = process.hrtime.bigint();

    tracer.startActiveSpan(
      spanName,
      { kind: SpanKind.SERVER, attributes, links: parent.links },
      parent.context,
      (span) => {
        if (isJSONRPCRequest(message)) {
          this.pending.set(requestKey(message.id), {
            span,
            startedAt,
            metricAttributes,
            method: message.method,
          });
        }

        try {
          this.onmessage?.(message, extra);
          if (isJSONRPCNotification(message)) {
            finishOperation(span, startedAt, metricAttributes);
          }
        } catch (error) {
          finishOperation(span, startedAt, metricAttributes, error, "handler_error");
          if (isJSONRPCRequest(message)) {
            this.pending.delete(requestKey(message.id));
          }
          throw error;
        }
      },
    );
  }

  private finishPending(
    id: string | number,
    response?: JSONRPCMessage,
    error?: unknown,
    explicitErrorType?: string,
  ): void {
    const key = requestKey(id);
    const operation = this.pending.get(key);
    if (!operation) {
      return;
    }
    this.pending.delete(key);

    let errorType = explicitErrorType;
    let statusDescription: string | undefined;
    let toolError = false;
    if (error === undefined && response && isJSONRPCErrorResponse(response)) {
      const statusCode = String(response.error.code);
      errorType = statusCode;
      statusDescription = response.error.message;
      operation.span.setAttribute(ATTR_RPC_RESPONSE_STATUS_CODE, statusCode);
      operation.metricAttributes[ATTR_RPC_RESPONSE_STATUS_CODE] = statusCode;
    } else if (
      error === undefined
      && response
      && isJSONRPCResultResponse(response)
      && isToolErrorResult(response.result)
    ) {
      errorType = "tool_error";
      toolError = true;
    }

    if (
      response
      && error === undefined
      && operation.method === "tools/call"
      && isJSONRPCResultResponse(response)
      && !toolError
      && isToolContentCaptureEnabled()
    ) {
      operation.span.setAttribute(ATTR_GEN_AI_TOOL_CALL_RESULT, safeJson(response.result));
    }

    finishOperation(
      operation.span,
      operation.startedAt,
      operation.metricAttributes,
      error,
      errorType,
      statusDescription,
    );
  }

  private finishAllPending(errorType: string): void {
    for (const operation of this.pending.values()) {
      finishOperation(
        operation.span,
        operation.startedAt,
        operation.metricAttributes,
        undefined,
        errorType,
      );
    }
    this.pending.clear();
  }

  private finishSession(): void {
    if (this.sessionEnded || this.options.recordSession === false) {
      return;
    }
    this.sessionEnded = true;
    sessionDuration.record(durationSeconds(this.connectedAt), {
      "network.transport": this.options.networkTransport,
      ...(this.options.networkProtocolName
        ? { [ATTR_NETWORK_PROTOCOL_NAME]: this.options.networkProtocolName }
        : {}),
      ...(this.protocolVersion ? { [ATTR_MCP_PROTOCOL_VERSION]: this.protocolVersion } : {}),
      ...(this.sessionErrorType ? { "error.type": this.sessionErrorType } : {}),
    });
  }
}

function operationAttributes(
  message: Extract<JSONRPCMessage, { method: string }>,
  protocolVersion: string | undefined,
  options: McpTelemetryOptions,
  sessionId: string | undefined,
): Attributes {
  const attributes: Attributes = {
    [ATTR_MCP_METHOD_NAME]: message.method,
    "jsonrpc.protocol.version": message.jsonrpc,
    "network.transport": options.networkTransport,
  };

  if (isJSONRPCRequest(message)) {
    attributes[ATTR_JSONRPC_REQUEST_ID] = String(message.id);
  }
  if (protocolVersion) {
    attributes[ATTR_MCP_PROTOCOL_VERSION] = protocolVersion;
  }
  if (sessionId) {
    attributes[ATTR_MCP_SESSION_ID] = sessionId;
  }
  if (options.networkProtocolName) {
    attributes[ATTR_NETWORK_PROTOCOL_NAME] = options.networkProtocolName;
  }

  const target = operationTarget(message);
  if (message.method === "tools/call" && target) {
    attributes[ATTR_GEN_AI_OPERATION_NAME] = GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL;
    attributes[ATTR_GEN_AI_TOOL_NAME] = target;
    if (isToolContentCaptureEnabled()) {
      const args = readParams(message)?.arguments;
      if (args !== undefined) {
        attributes[ATTR_GEN_AI_TOOL_CALL_ARGUMENTS] = safeJson(args);
      }
    }
  } else if (message.method === "prompts/get" && target) {
    attributes[ATTR_GEN_AI_PROMPT_NAME] = target;
  }

  const resourceUri = operationResourceUri(message);
  if (resourceUri) {
    attributes[ATTR_MCP_RESOURCE_URI] = resourceUri;
  }

  return attributes;
}

function metricOperationAttributes(
  message: Extract<JSONRPCMessage, { method: string }>,
  protocolVersion: string | undefined,
  options: McpTelemetryOptions,
): Attributes {
  const target = operationTarget(message);
  return {
    [ATTR_MCP_METHOD_NAME]: message.method,
    "network.transport": options.networkTransport,
    ...(options.networkProtocolName
      ? { [ATTR_NETWORK_PROTOCOL_NAME]: options.networkProtocolName }
      : {}),
    ...(protocolVersion ? { [ATTR_MCP_PROTOCOL_VERSION]: protocolVersion } : {}),
    ...(message.method === "tools/call" && target
      ? {
          [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
          [ATTR_GEN_AI_TOOL_NAME]: target,
        }
      : {}),
    ...(message.method === "prompts/get" && target
      ? { [ATTR_GEN_AI_PROMPT_NAME]: target }
      : {}),
  };
}

function finishOperation(
  span: Span,
  startedAt: bigint,
  metricAttributes: Attributes,
  error?: unknown,
  errorType?: string,
  statusDescription?: string,
): void {
  const resolvedErrorType = errorType ?? (error !== undefined ? errorName(error) : undefined);
  const attributes = resolvedErrorType
    ? { ...metricAttributes, "error.type": resolvedErrorType }
    : metricAttributes;

  if (resolvedErrorType) {
    span.setAttribute("error.type", resolvedErrorType);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      ...(statusDescription ? { message: statusDescription } : {}),
    });
    if (error instanceof Error) {
      span.recordException(error);
    }
  }

  operationDuration.record(durationSeconds(startedAt), attributes);
  span.end();
}

function extractParentContext(
  message: Extract<JSONRPCMessage, { method: string }>,
  activeContext: Context,
  connectionContext: Context,
): { context: Context; links: Link[] } {
  const params = readParams(message);
  const metadata = params?._meta;
  const base = trace.getSpanContext(activeContext)?.isRemote === true
    || trace.getSpan(activeContext) !== undefined
    ? activeContext
    : connectionContext;

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { context: base, links: [] };
  }

  const extracted = propagation.extract(base, metadata as Record<string, unknown>, {
    keys: (carrier) => Object.keys(carrier),
    get: (carrier, key) => {
      const value = carrier[key];
      return typeof value === "string" ? value : undefined;
    },
  });
  const extractedSpan = trace.getSpanContext(extracted);
  const transportSpan = trace.getSpanContext(base);
  const links = extractedSpan?.isRemote === true
    && transportSpan !== undefined
    && (transportSpan.traceId !== extractedSpan.traceId || transportSpan.spanId !== extractedSpan.spanId)
    ? [{ context: transportSpan }]
    : [];

  return { context: extracted, links };
}

function operationSpanName(message: Extract<JSONRPCMessage, { method: string }>): string {
  const target = operationTarget(message);
  return target ? `${message.method} ${target}` : message.method;
}

function operationTarget(message: Extract<JSONRPCMessage, { method: string }>): string | undefined {
  const params = readParams(message);
  if (message.method === "tools/call" || message.method === "prompts/get") {
    return typeof params?.name === "string" ? params.name : undefined;
  }
  return undefined;
}

function operationResourceUri(
  message: Extract<JSONRPCMessage, { method: string }>,
): string | undefined {
  if (
    message.method !== "resources/read"
    && message.method !== "resources/subscribe"
    && message.method !== "resources/unsubscribe"
    && message.method !== "notifications/resources/updated"
  ) {
    return undefined;
  }
  const uri = readParams(message)?.uri;
  return typeof uri === "string" ? uri : undefined;
}

function resolveProtocolVersion(
  message: Extract<JSONRPCMessage, { method: string }>,
  extra: MessageExtraInfo | undefined,
  negotiatedVersion: string | undefined,
): string | undefined {
  const classifiedRevision = nonEmpty(extra?.classification?.revision);
  if (classifiedRevision) {
    return classifiedRevision;
  }

  const headerRevision = nonEmpty(extra?.request?.headers.get("mcp-protocol-version") ?? undefined);
  if (headerRevision) {
    return headerRevision;
  }
  if (negotiatedVersion) {
    return negotiatedVersion;
  }
  if (message.method === "initialize") {
    return nonEmpty(readParams(message)?.protocolVersion);
  }
  return undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readParams(message: Extract<JSONRPCMessage, { method: string }>): Record<string, unknown> | undefined {
  const params = "params" in message ? message.params : undefined;
  return params && typeof params === "object" && !Array.isArray(params)
    ? params as Record<string, unknown>
    : undefined;
}

function readCancelledRequestId(
  message: Extract<JSONRPCMessage, { method: string }>,
): string | number | undefined {
  const requestId = readParams(message)?.requestId;
  return typeof requestId === "string" || typeof requestId === "number" ? requestId : undefined;
}

function responseId(message: JSONRPCMessage): string | number | undefined {
  if (!isJSONRPCResultResponse(message) && !isJSONRPCErrorResponse(message)) {
    return undefined;
  }
  return message.id;
}

function requestKey(id: string | number): string {
  return `${typeof id}:${String(id)}`;
}

function isToolErrorResult(value: unknown): boolean {
  return value !== null
    && typeof value === "object"
    && "isError" in value
    && (value as { isError?: unknown }).isError === true;
}

function durationSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "error";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
