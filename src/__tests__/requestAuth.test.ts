import { extractApiKeyFromAuthorizationHeader } from '../requestAuth.js';

describe('extractApiKeyFromAuthorizationHeader', () => {
  it('extracts the token from a Bearer scheme header', () => {
    expect(extractApiKeyFromAuthorizationHeader('Bearer abc123xyz')).toBe('abc123xyz');
  });

  it('extracts the token from a Bearer scheme header case-insensitively', () => {
    expect(extractApiKeyFromAuthorizationHeader('bearer abc123xyz')).toBe('abc123xyz');
  });

  it('extracts the token from a Key scheme header', () => {
    expect(extractApiKeyFromAuthorizationHeader('Key abc123xyz')).toBe('abc123xyz');
  });

  it('extracts the token from a Key scheme header case-insensitively', () => {
    expect(extractApiKeyFromAuthorizationHeader('key abc123xyz')).toBe('abc123xyz');
  });

  it('treats a single whitespace-free value with no scheme prefix as a raw token', () => {
    expect(extractApiKeyFromAuthorizationHeader('abc123xyz')).toBe('abc123xyz');
  });

  it('rejects a Basic scheme header instead of falling back to a raw token', () => {
    expect(extractApiKeyFromAuthorizationHeader('Basic dXNlcjpwYXNz')).toBeUndefined();
  });

  it('rejects other unsupported schemes (e.g. Digest)', () => {
    expect(extractApiKeyFromAuthorizationHeader('Digest username="foo"')).toBeUndefined();
  });

  it('returns undefined for an undefined header', () => {
    expect(extractApiKeyFromAuthorizationHeader(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty header', () => {
    expect(extractApiKeyFromAuthorizationHeader('')).toBeUndefined();
  });

  it('returns undefined for a whitespace-only header', () => {
    expect(extractApiKeyFromAuthorizationHeader('   ')).toBeUndefined();
  });

  it('returns undefined for a header with only the Bearer keyword and no token', () => {
    expect(extractApiKeyFromAuthorizationHeader('Bearer')).toBeUndefined();
  });

  it('returns undefined for a header with only the Key keyword and no token', () => {
    expect(extractApiKeyFromAuthorizationHeader('Key')).toBeUndefined();
  });

  it('returns undefined for a Bearer scheme with only trailing whitespace and no token', () => {
    expect(extractApiKeyFromAuthorizationHeader('Bearer   ')).toBeUndefined();
  });

  it('uses the first value when the header is provided as an array', () => {
    expect(extractApiKeyFromAuthorizationHeader(['Bearer abc123xyz', 'Bearer other'])).toBe(
      'abc123xyz'
    );
  });
});
