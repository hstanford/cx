import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, configPath } from './config.js';

let tmpDir: string;
let prevCxHome: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-config-'));
  prevCxHome = process.env.CX_HOME;
  process.env.CX_HOME = tmpDir;
});

afterEach(() => {
  if (prevCxHome === undefined) delete process.env.CX_HOME;
  else process.env.CX_HOME = prevCxHome;
});

describe('loadConfig', () => {
  it('returns empty claudeArgs when config file is missing', () => {
    expect(loadConfig()).toEqual({ claudeArgs: [] });
  });

  it('parses claudeArgs from a valid config file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ claudeArgs: ['--permission-mode', 'bypassPermissions'] }),
    );
    expect(loadConfig()).toEqual({ claudeArgs: ['--permission-mode', 'bypassPermissions'] });
  });

  it('returns empty claudeArgs when the file contains invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), 'not json at all');
    expect(loadConfig()).toEqual({ claudeArgs: [] });
  });

  it('returns empty claudeArgs when the file has the wrong shape', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ claudeArgs: 'not-an-array' }));
    expect(loadConfig()).toEqual({ claudeArgs: [] });
  });
});

describe('configPath', () => {
  it('points to config.json inside cxHome', () => {
    expect(configPath()).toBe(path.join(tmpDir, 'config.json'));
  });
});
