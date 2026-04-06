import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createRedashClient, setActiveClient } from './redashClient.js';
import { createServer } from './index.js';
import { logger } from './logger.js';
import { RedashOAuthProvider, getRedashApiKeyFromAuth } from './auth.js';
import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || '8080'}`;

const oauthProvider = new RedashOAuthProvider();

const app = createMcpExpressApp({ host: '0.0.0.0' });

// OAuth routes (metadata, register, authorize, token, revoke)
app.use(mcpAuthRouter({
  provider: oauthProvider,
  issuerUrl: new URL(BASE_URL),
  baseUrl: new URL(BASE_URL),
  resourceServerUrl: new URL(`${BASE_URL}/mcp`),
  scopesSupported: [],
}));

// Parse URL-encoded form bodies for /authorize/submit
app.use('/authorize/submit', express.urlencoded({ extended: false }));

// Handle the authorization form submission
app.use('/authorize/submit', (req: Request, res: Response, next) => {
  if (req.method !== 'POST') return next();
  const { client_id, redirect_uri, code_challenge, state, api_key } = req.body;
  if (!client_id || !redirect_uri || !code_challenge || !api_key) {
    res.status(400).send('Missing required fields');
    return;
  }
  oauthProvider.handleAuthorizeSubmit(client_id, redirect_uri, code_challenge, state || undefined, api_key, res);
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Bearer auth middleware for /mcp endpoints
const bearerAuth = requireBearerAuth({ verifier: oauthProvider });

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();

// Set up Redash client from auth info
function setupRedashClient(req: Request): void {
  const auth = (req as any).auth as AuthInfo;
  const apiKey = getRedashApiKeyFromAuth(auth);
  const client = createRedashClient(apiKey);
  setActiveClient(client);
}

// MCP POST endpoint
app.post('/mcp', bearerAuth, async (req: Request, res: Response) => {
  setupRedashClient(req);

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  try {
    if (sessionId && transports.has(sessionId)) {
      // Existing session
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        req.body
      );
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport);
        }
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };

      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        req.body
      );
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null
      });
    }
  } catch (error) {
    logger.error(`Error handling MCP request: ${error}`);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
});

// SSE stream endpoint
app.get('/mcp', bearerAuth, async (req: Request, res: Response) => {
  setupRedashClient(req);
  const sessionId = req.headers['mcp-session-id'] as string;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse
  );
});

// Session termination endpoint
app.delete('/mcp', bearerAuth, async (req: Request, res: Response) => {
  setupRedashClient(req);
  const sessionId = req.headers['mcp-session-id'] as string;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse
  );
});

const PORT = parseInt(process.env.PORT || '8080');
app.listen(PORT, () => {
  logger.info(`Redash MCP HTTP server listening on port ${PORT}`);
  logger.info(`Base URL: ${BASE_URL}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  for (const transport of transports.values()) {
    await transport.close();
  }
  process.exit(0);
});
