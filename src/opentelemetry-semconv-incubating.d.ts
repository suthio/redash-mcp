// TypeScript 5.2 as embedded by ts-jest does not resolve the package's
// `incubating` conditional export. Declare the subset used here; production
// imports still come from @opentelemetry/semantic-conventions itself.
declare module "@opentelemetry/semantic-conventions/incubating" {
  export const ATTR_GEN_AI_OPERATION_NAME: "gen_ai.operation.name";
  export const ATTR_GEN_AI_PROMPT_NAME: "gen_ai.prompt.name";
  export const ATTR_GEN_AI_TOOL_CALL_ARGUMENTS: "gen_ai.tool.call.arguments";
  export const ATTR_GEN_AI_TOOL_CALL_RESULT: "gen_ai.tool.call.result";
  export const ATTR_GEN_AI_TOOL_NAME: "gen_ai.tool.name";
  export const ATTR_JSONRPC_REQUEST_ID: "jsonrpc.request.id";
  export const ATTR_MCP_METHOD_NAME: "mcp.method.name";
  export const ATTR_MCP_PROTOCOL_VERSION: "mcp.protocol.version";
  export const ATTR_MCP_RESOURCE_URI: "mcp.resource.uri";
  export const ATTR_MCP_SESSION_ID: "mcp.session.id";
  export const ATTR_RPC_RESPONSE_STATUS_CODE: "rpc.response.status_code";
  export const GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL: "execute_tool";
  export const METRIC_MCP_SERVER_OPERATION_DURATION: "mcp.server.operation.duration";
  export const METRIC_MCP_SERVER_SESSION_DURATION: "mcp.server.session.duration";
}
