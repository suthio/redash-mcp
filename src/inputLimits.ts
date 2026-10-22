// Keep the SDK's existing 4 MiB HTTP envelope, including long SQL strings.
export const MAX_HTTP_REQUEST_BYTES = 4 * 1024 * 1024;

// Object keys and array entries, not string length. A 1,000-widget layout
// (all five position fields per widget) fits; bound work before validation.
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;
