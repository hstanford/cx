import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { cxPort, mcpConfigPath, mcpUrl, writeMcpConfig, installHint } from './config.js';

let home: string;
let prevHome: string | undefined;
let prevPort: string | undefined;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  prevHome = process.env.CX_HOME; prevPort = process.env.CX_PORT;
  process.env.CX_HOME = home; delete process.env.CX_PORT;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.CX_HOME; else process.env.CX_HOME = prevHome;
  if (prevPort === undefined) delete process.env.CX_PORT; else process.env.CX_PORT = prevPort;
});

describe('mcp config', () => {
  it('defaults the port to 7591 and honors CX_PORT', () => {
    expect(cxPort()).toBe(7591);
    process.env.CX_PORT = '9000';
    expect(cxPort()).toBe(9000);
  });
  it('builds the loopback /mcp url', () => {
    expect(mcpUrl(7591)).toBe('http://127.0.0.1:7591/mcp');
  });
  it('writes a valid .mcp.json describing the cx http server', () => {
    writeMcpConfig(7591);
    const body = JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf8'));
    expect(body).toEqual({ mcpServers: { cx: { type: 'http', url: 'http://127.0.0.1:7591/mcp' } } });
  });
  it('installHint contains the mcp add command and --mcp-config flag', () => {
    const hint = installHint(7591);
    expect(hint).toContain('claude mcp add --transport http cx http://127.0.0.1:7591/mcp');
    expect(hint).toContain('--mcp-config');
  });
});
