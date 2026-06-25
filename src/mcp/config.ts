import fs from 'node:fs';
import path from 'node:path';
import { cxHome } from '../paths.js';

export function cxPort(): number {
  const p = process.env.CX_PORT;
  return p ? Number(p) : 7591;
}

export function mcpConfigPath(): string {
  return path.join(cxHome(), 'mcp.json');
}

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export function writeMcpConfig(port: number): void {
  const file = mcpConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = { mcpServers: { cx: { type: 'http', url: mcpUrl(port) } } };
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
}
