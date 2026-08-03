import { MODERN_MCP_PROTOCOL_VERSION } from "../mcpProtocol.js";

// Pin the modern wire revision so "modern" test rows cannot silently
// negotiate down to a legacy protocol version.
export const MODERN_CLIENT_OPTIONS = {
  versionNegotiation: { mode: { pin: MODERN_MCP_PROTOCOL_VERSION } },
} as const;

// Shared it.each table for suites that exercise both protocol eras.
export const CLIENT_VERSION_MATRIX = [
  ["legacy", undefined],
  ["modern", MODERN_CLIENT_OPTIONS],
] as const;
