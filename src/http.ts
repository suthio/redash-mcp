import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createRedashClient, setActiveClient } from './redashClient.js';
import { createServer } from './index.js';
import { logger } from './logger.js';
import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';

const app = createMcpExpressApp({ host: '0.0.0.0' });

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Session management
const transports = new Map<string, StreamableHTTPServerTransport>();

// API Key validation middleware for all /mcp endpoints
function requireApiKey(req: Request, res: Response): boolean {
  const apiKey = req.headers['x-redash-api-key'] as string;
  if (!apiKey) {
    res.status(401).json({ error: 'X-Redash-API-Key header is required' });
    return false;
  }
  try {
    const client = createRedashClient(apiKey);
    setActiveClient(client);
    return true;
  } catch (error) {
    res.status(400).json({ error: 'Invalid Redash configuration' });
    return false;
  }
}

// MCP POST endpoint
app.post('/mcp', async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

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
app.get('/mcp', async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
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
app.delete('/mcp', async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;
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
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down...');
  for (const transport of transports.values()) {
    await transport.close();
  }
  process.exit(0);
});
