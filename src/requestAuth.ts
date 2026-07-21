// Per-request Redash API key propagation.
//
// In stdio mode there is exactly one MCP client per process, so a single
// REDASH_API_KEY environment variable is enough. In HTTP mode a single
// process is shared by many users, each with their own personal Redash
// API token. Those tokens travel with every incoming MCP HTTP request in
// the standard `Authorization` header and must be used only for the
// Redash API calls triggered by that specific request.
//
// AsyncLocalStorage lets us stash the token for the lifetime of a single
// request's async call chain (including everything awaited from within
// it) without threading it through every function signature in index.ts.
import { AsyncLocalStorage } from "node:async_hooks";

const redashApiKeyStorage = new AsyncLocalStorage<string | undefined>();

/**
 * Runs `fn` with `apiKey` bound as the "current request's" Redash API key.
 * Any RedashClient call made (directly or indirectly, including across
 * awaits) from within `fn` will use this key instead of the static
 * REDASH_API_KEY env var, unless `apiKey` is undefined.
 */
export function runWithRedashApiKey<T>(apiKey: string | undefined, fn: () => T): T {
  return redashApiKeyStorage.run(apiKey, fn);
}

/**
 * Returns the Redash API key bound for the currently executing request
 * (via `runWithRedashApiKey`), or `undefined` if none is bound (e.g. in
 * stdio mode, or an HTTP request that didn't send an Authorization header).
 */
export function getRequestRedashApiKey(): string | undefined {
  return redashApiKeyStorage.getStore();
}

/**
 * Extracts a bearer/API token from the raw value of an HTTP `Authorization`
 * header.
 *
 * Accepted formats:
 *   - `Bearer <token>`  (common convention used by many MCP/HTTP clients)
 *   - `Key <token>`     (Redash's own scheme, in case a client mirrors it)
 *   - `<token>`         (raw token, no scheme prefix)
 *
 * The returned token is the raw Redash personal access token/API key. It is
 * the caller's responsibility to prefix it with `Key ` again before sending
 * it to Redash (Redash's own convention), see RedashClient.
 *
 * Never logs the header value; only returns it.
 */
export function extractApiKeyFromAuthorizationHeader(
  headerValue: string | string[] | undefined
): string | undefined {
  if (!headerValue) {
    return undefined;
  }

  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }

  const schemeMatch = trimmed.match(/^(Bearer|Key)\s+(.+)$/i);
  const token = schemeMatch ? schemeMatch[2].trim() : trimmed;

  return token || undefined;
}
