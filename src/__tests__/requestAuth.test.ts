import { extractApiKeyFromAuthorizationHeader } from '../requestAuth.js';

describe('extractApiKeyFromAuthorizationHeader', () => {
  it('extracts the token from a Bearer scheme header', () => {
    expect(extractApiKeyFromAuthorizationHeader('Bearer abc123xyz')).toEqual({
      status: 'valid',
      apiKey: 'abc123xyz',
    });
  });

  it('extracts the token from a Bearer scheme header case-insensitively', () => {
    expect(extractApiKeyFromAuthorizationHeader('bearer abc123xyz')).toEqual({
      status: 'valid',
      apiKey: 'abc123xyz',
    });
  });

  it('extracts the token from a Key scheme header', () => {
    expect(extractApiKeyFromAuthorizationHeader('Key abc123xyz')).toEqual({
      status: 'valid',
      apiKey: 'abc123xyz',
    });
  });

  it('extracts the token from a Key scheme header case-insensitively', () => {
    expect(extractApiKeyFromAuthorizationHeader('key abc123xyz')).toEqual({
      status: 'valid',
      apiKey: 'abc123xyz',
    });
  });

  it('treats a single whitespace-free value with no scheme prefix as a raw token', () => {
    expect(extractApiKeyFromAuthorizationHeader('abc123xyz')).toEqual({
      status: 'valid',
      apiKey: 'abc123xyz',
    });
  });

  it('rejects a Basic scheme header instead of falling back to a raw token', () => {
    const result = extractApiKeyFromAuthorizationHeader('Basic dXNlcjpwYXNz');
    expect(result.status).toBe('invalid');
  });

  it('rejects other unsupported schemes (e.g. Digest)', () => {
    const result = extractApiKeyFromAuthorizationHeader('Digest username="foo"');
    expect(result.status).toBe('invalid');
  });

  it('returns "absent" for an undefined header', () => {
    expect(extractApiKeyFromAuthorizationHeader(undefined)).toEqual({ status: 'absent' });
  });

  it('returns "absent" for an empty header', () => {
    expect(extractApiKeyFromAuthorizationHeader('')).toEqual({ status: 'absent' });
  });

  it('returns "absent" for a whitespace-only header', () => {
    expect(extractApiKeyFromAuthorizationHeader('   ')).toEqual({ status: 'absent' });
  });

  it('rejects a header with only the Bearer keyword and no token', () => {
    const result = extractApiKeyFromAuthorizationHeader('Bearer');
    expect(result.status).toBe('invalid');
  });

  it('rejects a header with only the Key keyword and no token', () => {
    const result = extractApiKeyFromAuthorizationHeader('Key');
    expect(result.status).toBe('invalid');
  });

  it('rejects a Bearer scheme with only trailing whitespace and no token', () => {
    const result = extractApiKeyFromAuthorizationHeader('Bearer   ');
    expect(result.status).toBe('invalid');
  });

  it('uses the first value when the header is provided as an array', () => {
    expect(
      extractApiKeyFromAuthorizationHeader(['Bearer abc123xyz', 'Bearer other'])
    ).toEqual({ status: 'valid', apiKey: 'abc123xyz' });
  });

  // Regression coverage for the authentication-boundary bug: a supplied but
  // invalid/unsupported Authorization header must be distinguishable from
  // "no header at all", so that callers never fall back to a static
  // REDASH_API_KEY for a rejected credential. See httpServer.test.ts for the
  // end-to-end version of this assertion (asserting the HTTP request itself
  // is rejected and never reaches Redash with the static fallback key).
  describe('preserves the "absent" vs "invalid" boundary', () => {
    it('marks a Basic scheme header as invalid, not absent', () => {
      expect(extractApiKeyFromAuthorizationHeader('Basic dXNlcjpwYXNz').status).toBe('invalid');
    });

    it('marks an empty Bearer token as invalid, not absent', () => {
      expect(extractApiKeyFromAuthorizationHeader('Bearer ').status).toBe('invalid');
    });

    it('marks a Digest scheme header as invalid, not absent', () => {
      expect(extractApiKeyFromAuthorizationHeader('Digest realm="redash"').status).toBe('invalid');
    });

    it('marks a missing header as absent, not invalid', () => {
      expect(extractApiKeyFromAuthorizationHeader(undefined).status).toBe('absent');
    });
  });
});
