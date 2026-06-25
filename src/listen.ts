import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp/server.js';
import { writeMcpConfig, cxPort, mcpUrl, installHint } from './mcp/config.js';
import { type Deps } from './commands.js';

export async function createCxHttpServer(deps: Deps): Promise<Server> {
  const mcp = buildMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await mcp.connect(transport);
  return createServer((req, res) => {
    if (req.url === '/mcp') {
      transport.handleRequest(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
    } else {
      res.writeHead(404).end();
    }
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
