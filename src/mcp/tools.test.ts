import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { handleSpawn, handleList } from './tools.js';
import { cmdArchive, type Deps } from '../commands.js';
import { loadRegistry } from '../registry.js';
import { type Runner } from '../tmux.js';

const runner: Runner = {
  capture(_c, args) {
    if (args[0] === 'list-windows') return { status: 0, stdout: '' }; // nothing live
    return { status: 0, stdout: '' };
  },
  interactive() { throw new Error('MCP spawn must not attach (interactive called)'); },
};

let deps: Deps;
let regPath: string;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  regPath = path.join(dir, 'registry.json');
  deps = { regPath, runner };
});

describe('handleSpawn', () => {
  it('creates a detached stream and returns its identity', () => {
    const out = handleSpawn({ purpose: 'fork this tangent', seed: 'pick up X' }, deps);
    expect(out.slug).toBeTruthy();
    expect(out.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(loadRegistry(regPath).streams).toHaveLength(1);
  });
});

describe('handleList', () => {
  it('returns the streams as structured rows', () => {
    handleSpawn({ purpose: 'one', dir: '/tmp' }, deps);
    const rows = handleList(deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('purpose', 'one');
    expect(rows[0]).toHaveProperty('status');
  });

  it('excludes archived streams', () => {
    handleSpawn({ purpose: 'visible', dir: '/tmp' }, deps);
    const { slug } = handleSpawn({ purpose: 'archived', dir: '/tmp' }, deps);
    cmdArchive({ slug }, deps);
    const rows = handleList(deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('purpose', 'visible');
  });
});
