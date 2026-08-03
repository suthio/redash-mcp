// The SDK exposes legacy protocol versions publicly, but not the modern wire
// revision needed when a client must pin its handshake instead of falling back.
export const MODERN_MCP_PROTOCOL_VERSION = "2026-07-28" as const;
