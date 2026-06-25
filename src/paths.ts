import os from 'node:os';
import path from 'node:path';

export function cxHome(): string {
  return process.env.CX_HOME ?? path.join(os.homedir(), '.cx');
}

export function registryPath(): string {
  return path.join(cxHome(), 'registry.json');
}
