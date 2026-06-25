import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { readStreams } from './useStreams.js';
import { cmdNew, type Deps } from '../commands.js';
import { type Runner } from '../tmux.js';

const runner: Runner = {
  capture(_c, args) {
    if (args[0] === 'list-windows') return { status: 0, stdout: '' }; // nothing live
    return { status: 0, stdout: '' };
  },
  interactive() { return 0; },
};

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  deps = { regPath: path.join(dir, 'registry.json'), runner };
});

describe('readStreams', () => {
  it('returns reconciled, sorted streams', () => {
    cmdNew({ purpose: 'one', dir: '/tmp', slug: 'one' }, deps);
    const streams = readStreams(deps);
    expect(streams).toHaveLength(1);
    expect(streams[0].status).toBe('stopped'); // reconciled: no live window
  });
});
