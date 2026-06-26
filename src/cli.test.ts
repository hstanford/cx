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
    runCli(['new', 'fix parser bug', '--slug', 'prs'], deps);
    const res = runCli(['ls'], deps);
    expect(res.output).toMatch(/prs/);
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

  it('archive then restore round-trip', () => {
    runCli(['new', 'archivable', '--slug', 'arcv'], deps);
    const archRes = runCli(['archive', 'arcv'], deps);
    expect(archRes.output).toBe('archived "arcv"');
    const restRes = runCli(['restore', 'arcv'], deps);
    expect(restRes.output).toBe('restored "arcv" — back up and running');
  });

  it('ls --archived shows archived, hides active', () => {
    runCli(['new', 'active', '--slug', 'act'], deps);
    runCli(['new', 'archived', '--slug', 'arcd'], deps);
    runCli(['archive', 'arcd'], deps);
    const res = runCli(['ls', '--archived'], deps);
    expect(res.output).toMatch(/arcd/);
    expect(res.output).not.toMatch(/act/);
  });

  it('ls default hides archived', () => {
    runCli(['new', 'active', '--slug', 'act2'], deps);
    runCli(['new', 'archived', '--slug', 'arcd2'], deps);
    runCli(['archive', 'arcd2'], deps);
    const res = runCli(['ls'], deps);
    expect(res.output).toMatch(/act2/);
    expect(res.output).not.toMatch(/arcd2/);
  });
});
