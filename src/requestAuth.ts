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
 * Result of parsing an incoming `Authorization` header.
 *
 * Callers MUST distinguish these three cases rather than collapsing them
 * into a single `undefined`:
 *
 *   - `absent`:  no `Authorization` header was supplied at all. It is safe
 *                to fall back to the static `REDASH_API_KEY` (this is the
 *                stdio-mode / header-less HTTP-mode behavior).
 *   - `valid`:   a supported scheme was used and a token was extracted. Use
 *                `apiKey` for this request; never fall back to the static
 *                key.
 *   - `invalid`: an `Authorization` header was supplied, but it used an
 *                unsupported scheme or was otherwise malformed (e.g.
 *                `Basic ...`, `Digest ...`, an empty `Bearer`). The request
 *                MUST be rejected. Falling back to the static
 *                `REDASH_API_KEY` here would turn a rejected/unsupported
 *                client credential into unintended access via the shared
 *                service-account key.
 */
export type AuthorizationHeaderResult =
  | { status: "absent" }
  | { status: "valid"; apiKey: string }
  | { status: "invalid"; reason: string };

/**
 * Parses the raw value of an HTTP `Authorization` header and extracts a
 * Redash API key from it, while preserving the distinction between "no
 * header was sent" and "a header was sent but rejected" - see
 * {@link AuthorizationHeaderResult}.
 *
 * Accepted formats (result: `valid`):
 *   - `Bearer <token>`  (common convention used by many MCP/HTTP clients)
 *   - `Key <token>`     (Redash's own scheme, in case a client mirrors it)
 *   - `<token>`         (raw token, no scheme prefix, no internal whitespace)
 *
 * Any other scheme (e.g. `Basic ...`, `Digest ...`) - or any value that
 * contains whitespace but isn't a recognized `Bearer`/`Key` prefix, or a
 * bare `Bearer`/`Key` with no token - is rejected (result: `invalid`) rather
 * than being silently treated as a raw token or as "no credential supplied".
 * This keeps the boundary between "Redash API key" and "some other kind of
 * credential" explicit.
 *
 * The returned token is the raw Redash personal access token/API key. It is
 * the caller's responsibility to prefix it with `Key ` again before sending
 * it to Redash (Redash's own convention), see RedashClient.
 *
 * Never logs the header value; only returns it.
 */
export function extractApiKeyFromAuthorizationHeader(
  headerValue: string | string[] | undefined
): AuthorizationHeaderResult {
  if (!headerValue) {
    return { status: "absent" };
  }

  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { status: "absent" };
  }

  const schemeMatch = trimmed.match(/^(Bearer|Key)\s+(.+)$/i);
  if (schemeMatch) {
    const token = schemeMatch[2].trim();
    if (token) {
      return { status: "valid", apiKey: token };
    }
    return { status: "invalid", reason: "Bearer/Key scheme with a blank token" };
  }

  // A bare `Bearer` or `Key` with no token after it is a malformed scheme
  // usage, not a valid raw token - reject it rather than treating the
  // literal word as the API key.
  if (/^(Bearer|Key)$/i.test(trimmed)) {
    return { status: "invalid", reason: "Bearer/Key scheme with no token" };
  }

  // No recognized scheme prefix. Only accept this as a raw token if it has
  // no internal whitespace - anything with whitespace (e.g. `Basic <blob>`)
  // is an unsupported/unrecognized scheme and must be rejected outright.
  if (/\s/.test(trimmed)) {
    return { status: "invalid", reason: "Unsupported or unrecognized Authorization scheme" };
  }

  return { status: "valid", apiKey: trimmed };
}
