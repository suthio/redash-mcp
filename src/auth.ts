import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { logger } from './logger.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// In-memory stores
const clients = new Map<string, OAuthClientInformationFull>();
const authCodes = new Map<string, {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  redashApiKey: string;
  state?: string;
  expiresAt: number;
}>();
const tokens = new Map<string, {
  clientId: string;
  redashApiKey: string;
  expiresAt: number;
}>();
const refreshTokens = new Map<string, {
  clientId: string;
  redashApiKey: string;
}>();

class RedashClientsStore implements OAuthRegisteredClientsStore {
  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return clients.get(clientId);
  }

  registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>): OAuthClientInformationFull {
    const clientId = randomUUID();
    const clientSecret = randomBytes(32).toString('hex');
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    clients.set(clientId, full);
    logger.info(`Registered OAuth client: ${clientId}`);
    return full;
  }
}

export class RedashOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new RedashClientsStore();

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    // Render an HTML form for the user to enter their Redash API key
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redash MCP - Authorization</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 20px; background: #f5f5f5; }
    .card { background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 1.4em; margin: 0 0 8px; }
    p { color: #666; font-size: 0.9em; margin: 0 0 24px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.9em; }
    input[type="text"] { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1em; box-sizing: border-box; }
    input[type="text"]:focus { outline: none; border-color: #4a90d9; box-shadow: 0 0 0 3px rgba(74,144,217,0.15); }
    button { width: 100%; padding: 12px; background: #4a90d9; color: white; border: none; border-radius: 8px; font-size: 1em; font-weight: 600; cursor: pointer; margin-top: 20px; }
    button:hover { background: #3a7bc8; }
    .client-name { color: #4a90d9; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Redash MCP Authorization</h1>
    <p>Enter your Redash API key to authorize <span class="client-name">${escapeHtml(client.client_name || 'the application')}</span>.</p>
    <form method="POST" action="/authorize/submit">
      <input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
      <input type="hidden" name="state" value="${escapeHtml(params.state || '')}">
      <label for="api_key">Redash API Key</label>
      <input type="text" id="api_key" name="api_key" placeholder="Enter your Redash API key" required autofocus>
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const code = authCodes.get(authorizationCode);
    if (!code) throw new Error('Invalid authorization code');
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const code = authCodes.get(authorizationCode);
    if (!code) throw new Error('Invalid authorization code');
    if (code.clientId !== client.client_id) throw new Error('Client mismatch');
    if (redirectUri && code.redirectUri !== redirectUri) throw new Error('redirect_uri mismatch');
    if (Date.now() > code.expiresAt) {
      authCodes.delete(authorizationCode);
      throw new Error('Authorization code expired');
    }

    authCodes.delete(authorizationCode);

    const accessToken = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const expiresIn = 3600 * 24 * 30; // 30 days

    tokens.set(accessToken, {
      clientId: client.client_id,
      redashApiKey: code.redashApiKey,
      expiresAt: Date.now() + expiresIn * 1000,
    });

    refreshTokens.set(refreshToken, {
      clientId: client.client_id,
      redashApiKey: code.redashApiKey,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string
  ): Promise<OAuthTokens> {
    const stored = refreshTokens.get(refreshToken);
    if (!stored) throw new Error('Invalid refresh token');
    if (stored.clientId !== client.client_id) throw new Error('Client mismatch');

    const accessToken = randomBytes(32).toString('hex');
    const newRefreshToken = randomBytes(32).toString('hex');
    const expiresIn = 3600 * 24 * 30;

    tokens.set(accessToken, {
      clientId: client.client_id,
      redashApiKey: stored.redashApiKey,
      expiresAt: Date.now() + expiresIn * 1000,
    });

    refreshTokens.delete(refreshToken);
    refreshTokens.set(newRefreshToken, {
      clientId: client.client_id,
      redashApiKey: stored.redashApiKey,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = tokens.get(token);
    if (!stored) throw new Error('Invalid access token');
    if (Date.now() > stored.expiresAt) {
      tokens.delete(token);
      throw new Error('Access token expired');
    }

    return {
      token,
      clientId: stored.clientId,
      scopes: [],
      expiresAt: Math.floor(stored.expiresAt / 1000),
      extra: { redashApiKey: stored.redashApiKey },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    tokens.delete(request.token);
    refreshTokens.delete(request.token);
  }

  /**
   * Handle the authorization form submission.
   * Called from the POST /authorize/submit route.
   */
  handleAuthorizeSubmit(
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    state: string | undefined,
    redashApiKey: string,
    res: Response
  ): void {
    // Validate client exists
    const client = this.clientsStore.getClient(clientId);
    if (!client) {
      res.status(400).send('Invalid client_id');
      return;
    }

    // Validate redirect_uri matches a registered URI
    const registeredUris = client.redirect_uris || [];
    if (!registeredUris.some(uri => uri.toString() === redirectUri)) {
      res.status(400).send('Invalid redirect_uri');
      return;
    }

    const code = randomBytes(16).toString('hex');
    authCodes.set(code, {
      clientId,
      codeChallenge,
      redirectUri,
      redashApiKey,
      state,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
    });

    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  }
}

/**
 * Get the Redash API key from the auth info attached to the request.
 */
export function getRedashApiKeyFromAuth(auth: AuthInfo): string {
  const apiKey = auth.extra?.redashApiKey;
  if (typeof apiKey !== 'string' || !apiKey) {
    throw new Error('No Redash API key in auth info');
  }
  return apiKey;
}
