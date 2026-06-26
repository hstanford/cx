import { createServer, type Server, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { buildMcpServer } from './mcp/server.js';
import { writeMcpConfig, cxPort, mcpUrl, installHint } from './mcp/config.js';
import { type Deps } from './commands.js';

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export async function createCxHttpServer(deps: Deps): Promise<Server> {
  // One StreamableHTTP transport PER MCP session, created on `initialize` and
  // keyed by the `mcp-session-id` header. A single transport connected once at
  // startup rejects every client's initialize with "Server already initialized" —
  // each client connection needs its own transport + server instance.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  return createServer((req, res) => {
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    (async () => {
      const body = await readJsonBody(req);
      const header = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(header) ? header[0] : header;

      const existing = sessionId ? transports.get(sessionId) : undefined;
      if (existing) {
        await existing.handleRequest(req, res, body);
        return;
      }
      if (req.method !== 'POST' || !isInitializeRequest(body)) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session — send initialize first' }, id: null }),
        );
        return;
      }
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => { transports.set(id, transport); },
      });
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId); };
      await buildMcpServer(deps).connect(transport);
      await transport.handleRequest(req, res, body);
    })().catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
  });
}

export async function listen(deps: Deps, opts: { port?: number } = {}): Promise<void> {
  const port = opts.port ?? cxPort();
  const httpServer = await createCxHttpServer(deps);
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`cx listen: already listening on ${mcpUrl(port)}`);
        console.log(installHint(port));
        resolve();
      } else {
        reject(err);
      }
    });
    httpServer.listen(port, '127.0.0.1', () => {
      writeMcpConfig(port);
      console.log(`cx listen: serving MCP on ${mcpUrl(port)}`);
      console.log(installHint(port));
      resolve();
    });
  });
}
