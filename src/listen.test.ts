import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { createCxHttpServer } from './listen.js';
import { type Deps } from './commands.js';
import { type Runner } from './tmux.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const runner: Runner = {
  capture(_c, args) { return { status: 0, stdout: args[0] === 'list-windows' ? '' : '' }; },
  interactive() { return 0; },
};

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  deps = { regPath: path.join(dir, 'registry.json'), runner };
});

describe('cx MCP server over HTTP', () => {
  it('exposes cx_spawn and cx_list to an MCP client', async () => {
    const httpServer = await createCxHttpServer(deps);
    await new Promise<void>(r => httpServer.listen(0, '127.0.0.1', r));
    const port = (httpServer.address() as AddressInfo).port;

    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    expect(names).toContain('cx_spawn');
    expect(names).toContain('cx_list');

    await client.close();
    await new Promise<void>(r => httpServer.close(() => r()));
  });
});
