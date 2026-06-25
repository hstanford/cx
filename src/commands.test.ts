import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { cmdNew, cmdLs, cmdGo, cmdDone, cmdEdit, cmdRm, listStreams, type Deps } from './commands.js';
import { loadRegistry, getStream } from './registry.js';
import { type Runner } from './tmux.js';

let regPath: string;
let newWindowCalls: { slug: string; dir: string; command: string }[];

function recordingRunner(): Runner {
  return {
    capture(_cmd, args) {
      if (args[0] === 'new-window') {
        const slug = args[args.indexOf('-n') + 1];
        const dir = args[args.indexOf('-c') + 1];
        const command = args[args.length - 1];
        newWindowCalls.push({ slug, dir, command });
      }
      if (args[0] === 'list-windows') {
        return { status: 0, stdout: newWindowCalls.map(c => c.slug).join('\n') };
      }
      if (args[0] === 'display-message') return { status: 0, stdout: 'node' };
      return { status: 0, stdout: '' };
    },
    interactive() { return 0; },
  };
}

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  regPath = path.join(dir, 'registry.json');
  newWindowCalls = [];
  deps = { regPath, runner: recordingRunner() };
});

describe('cmdNew', () => {
  it('registers a running stream and opens a tmux window with the new invocation', () => {
    const s = cmdNew({ purpose: 'refresh triggers', dir: '/tmp/proj' }, deps);
    expect(s.status).toBe('running');
    expect(s.purpose).toBe('refresh triggers');
    expect(s.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(loadRegistry(regPath).streams).toHaveLength(1);

    const call = newWindowCalls[0];
    expect(call.dir).toBe('/tmp/proj');
    expect(call.command).toContain('--session-id');
    expect(call.command).toContain(s.sessionId);
    expect(call.command).toContain('--remote-control');
  });

  it('derives a unique slug from the name/purpose', () => {
    cmdNew({ purpose: 'infra cleanup', dir: '/tmp', slug: 'infra' }, deps);
    const s2 = cmdNew({ purpose: 'infra again', dir: '/tmp', slug: 'infra' }, deps);
    expect(s2.slug).toBe('infra-2');
  });
});

describe('cmdNew non-ASCII slug fallback', () => {
  it('falls back to "stream" slug when purpose is all non-ASCII', () => {
    const s = cmdNew({ purpose: '日本語', dir: '/tmp', attach: false }, deps);
    expect(s.slug).toBe('stream');
  });
  it('produces a unique non-empty slug on a second all-non-ASCII call', () => {
    cmdNew({ purpose: '日本語', dir: '/tmp', attach: false }, deps);
    const s2 = cmdNew({ purpose: '日本語', dir: '/tmp', attach: false }, deps);
    expect(s2.slug).toBe('stream-2');
  });
});

describe('cmdLs', () => {
  it('lists registered streams and reconciles liveness', () => {
    cmdNew({ purpose: 'one', dir: '/tmp' }, deps);
    const out = cmdLs(deps);
    expect(out).toMatch(/one/);
  });
});

describe('cmdGo', () => {
  it('revives a stopped stream with a resume invocation and marks it running', () => {
    const s = cmdNew({ purpose: 'revive me', dir: '/tmp', slug: 'rev' }, deps);
    cmdDone({ slug: 'rev' }, deps);
    expect(getStream(loadRegistry(regPath), 'rev')?.status).toBe('stopped');

    newWindowCalls = [];
    cmdGo({ slug: 'rev' }, deps);
    const call = newWindowCalls.at(-1)!;
    expect(call.command).toContain('--resume');
    expect(call.command).toContain(s.sessionId);
    expect(getStream(loadRegistry(regPath), 'rev')?.status).toBe('running');
  });

  it('throws on an unknown slug', () => {
    expect(() => cmdGo({ slug: 'nope' }, deps)).toThrow(/nope/);
  });
});

describe('cmdDone', () => {
  it('keeps the registry entry but marks it stopped', () => {
    cmdNew({ purpose: 'keep me', dir: '/tmp', slug: 'keep' }, deps);
    cmdDone({ slug: 'keep' }, deps);
    const s = getStream(loadRegistry(regPath), 'keep');
    expect(s).toBeDefined();
    expect(s?.status).toBe('stopped');
  });
});

describe('cmdEdit', () => {
  it('updates purpose and name', () => {
    cmdNew({ purpose: 'old purpose', dir: '/tmp', slug: 'e' }, deps);
    const s = cmdEdit({ slug: 'e', purpose: 'new purpose', name: 'Renamed' }, deps);
    expect(s.purpose).toBe('new purpose');
    expect(s.name).toBe('Renamed');
    expect(getStream(loadRegistry(regPath), 'e')?.purpose).toBe('new purpose');
  });
});

describe('cmdRm', () => {
  it('removes the registry entry entirely', () => {
    cmdNew({ purpose: 'bye', dir: '/tmp', slug: 'r' }, deps);
    cmdRm({ slug: 'r' }, deps);
    expect(getStream(loadRegistry(regPath), 'r')).toBeUndefined();
  });
});

describe('listStreams', () => {
  it('returns reconciled, sorted streams (running first)', () => {
    cmdNew({ purpose: 'one', dir: '/tmp', slug: 'one', attach: false }, deps);
    const streams = listStreams(deps);
    expect(streams).toHaveLength(1);
    expect(streams[0].slug).toBe('one');
  });
});

describe('cmdNew mcp wiring', () => {
  it('adds --mcp-config when ~/.cx/mcp.json exists', () => {
    const prev = process.env.CX_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-home-'));
    process.env.CX_HOME = home;
    try {
      fs.writeFileSync(path.join(home, 'mcp.json'), '{}');
      cmdNew({ purpose: 'wired', dir: '/tmp', slug: 'wired', attach: false }, deps);
      expect(newWindowCalls.at(-1)!.command).toContain('--mcp-config');
    } finally {
      if (prev === undefined) delete process.env.CX_HOME; else process.env.CX_HOME = prev;
    }
  });
});

describe('cmdNew seed + attach', () => {
  it('passes the seed as the claude initial prompt', () => {
    const s = cmdNew({ purpose: 'tangent', dir: '/tmp', slug: 'tg', seed: 'continue the tangent' }, deps);
    const call = newWindowCalls.at(-1)!;
    expect(call.command).toContain('continue the tangent');
    expect(s.slug).toBe('tg');
  });
  it('does NOT attach when attach:false (no interactive call)', () => {
    let interactiveCalls = 0;
    const r: Runner = {
      capture: deps.runner.capture,
      interactive: () => { interactiveCalls++; return 0; },
    };
    cmdNew({ purpose: 'detached', dir: '/tmp', slug: 'det', attach: false }, { regPath, runner: r });
    expect(interactiveCalls).toBe(0);
  });
  it('does NOT attach when attach is omitted (background by default)', () => {
    let interactiveCalls = 0;
    const r: Runner = {
      capture: deps.runner.capture,
      interactive: () => { interactiveCalls++; return 0; },
    };
    cmdNew({ purpose: 'background default', dir: '/tmp', slug: 'bgd' }, { regPath, runner: r });
    expect(interactiveCalls).toBe(0);
  });
});
