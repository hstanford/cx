import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from './cli.js';
import { type Deps } from './commands.js';
import { type Runner } from './tmux.js';

const noopRunner: Runner = {
  capture(_c, args) {
    if (args[0] === 'list-windows') return { status: 0, stdout: '' };
    return { status: 0, stdout: '' };
  },
  interactive() { return 0; },
};

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  deps = { regPath: path.join(dir, 'registry.json'), runner: noopRunner };
});

describe('runCli', () => {
  it('signals a TUI launch when given no args', () => {
    expect(runCli([], deps)).toEqual({ launchTui: true });
  });
  it('new then ls round-trips through the CLI surface', () => {
    runCli(['new', 'refresh triggers', '--slug', 'trg'], deps);
    const res = runCli(['ls'], deps);
    expect(res.output).toMatch(/trg/);
  });
  it('errors clearly on an unknown command', () => {
    expect(() => runCli(['frobnicate'], deps)).toThrow(/unknown command/i);
  });
  it('open with no slug throws a usage error', () => {
    expect(() => runCli(['open'], deps)).toThrow(/usage: cx open/i);
  });

  it('restart with no slug and no --all throws', () => {
    expect(() => runCli(['restart'], deps)).toThrow(/slug.*--all|--all.*slug/i);
  });

  it('restart <slug> returns restarted output', () => {
    runCli(['new', 'restart-test', '--slug', 'rtest'], deps);
    const res = runCli(['restart', 'rtest'], deps);
    expect(res.output).toMatch(/restarted 1: rtest/);
  });

  it('restart --all with no live streams returns "nothing to restart"', () => {
    const res = runCli(['restart', '--all'], deps);
    expect(res.output).toBe('nothing to restart');
  });
});
