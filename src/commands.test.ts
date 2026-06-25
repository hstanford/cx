import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { cmdNew, cmdLs, cmdGo, cmdDone, cmdEdit, cmdRm, cmdOpen, cmdRestart, listStreams, type Deps } from './commands.js';
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

describe('cmdOpen', () => {
  const REMOTE_URL = 'https://claude.ai/code/session_abc123';

  function openRunner(paneText: string) {
    const openCalls: string[] = [];
    let capturePaneCalled = false;
    const runner: Runner = {
      capture(cmd, args) {
        if (args[0] === 'new-window') {
          const slug = args[args.indexOf('-n') + 1];
          const dir = args[args.indexOf('-c') + 1];
          const command = args[args.length - 1];
          newWindowCalls.push({ slug, dir, command });
          return { status: 0, stdout: '' };
        }
        if (args[0] === 'list-windows') return { status: 0, stdout: newWindowCalls.map(c => c.slug).join('\n') };
        if (args[0] === 'display-message') return { status: 0, stdout: 'node' };
        if (args[0] === 'capture-pane') { capturePaneCalled = true; return { status: 0, stdout: paneText }; }
        if (cmd === 'open') { openCalls.push(args[0]); return { status: 0, stdout: '' }; }
        return { status: 0, stdout: '' };
      },
      interactive() { return 0; },
    };
    return { runner, openCalls, getCapturePaneCalled: () => capturePaneCalled };
  }

  it('scrapes pane, opens the URL, persists remoteUrl when stream has none stored', () => {
    const paneText = `Starting claude...\n${REMOTE_URL}\nmore output`;
    const { runner, openCalls } = openRunner(paneText);
    const localDeps: Deps = { regPath, runner };
    cmdNew({ purpose: 'test', dir: '/tmp', slug: 'sc' }, localDeps);

    const result = cmdOpen({ slug: 'sc' }, localDeps);

    expect(result).toEqual({ opened: 'session', url: REMOTE_URL });
    expect(openCalls).toEqual([REMOTE_URL]);
    expect(getStream(loadRegistry(regPath), 'sc')?.remoteUrl).toBe(REMOTE_URL);
  });

  it('uses stored remoteUrl without scraping the pane', () => {
    const { runner, openCalls, getCapturePaneCalled } = openRunner('no url here');
    const localDeps: Deps = { regPath, runner };
    cmdNew({ purpose: 'stored', dir: '/tmp', slug: 'st' }, localDeps);
    // Patch the registry directly to pre-store a remoteUrl
    const reg = loadRegistry(regPath);
    const patched = { streams: reg.streams.map(s => s.slug === 'st' ? { ...s, remoteUrl: REMOTE_URL } : s) };
    fs.writeFileSync(regPath, JSON.stringify(patched, null, 2));

    const result = cmdOpen({ slug: 'st' }, localDeps);

    expect(result).toEqual({ opened: 'session', url: REMOTE_URL });
    expect(openCalls).toEqual([REMOTE_URL]);
    expect(getCapturePaneCalled()).toBe(false);
  });

  it('falls back to claude.ai/code when no URL found in pane', () => {
    const { runner, openCalls } = openRunner('no remote url here');
    const localDeps: Deps = { regPath, runner };
    cmdNew({ purpose: 'nope', dir: '/tmp', slug: 'np' }, localDeps);

    const result = cmdOpen({ slug: 'np' }, localDeps);

    expect(result).toEqual({ opened: 'list', url: 'https://claude.ai/code' });
    expect(openCalls).toEqual(['https://claude.ai/code']);
  });

  it('throws on unknown slug', () => {
    const { runner } = openRunner('');
    const localDeps: Deps = { regPath, runner };
    expect(() => cmdOpen({ slug: 'ghost' }, localDeps)).toThrow(/ghost/);
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

describe('claudeArgs passthrough from config', () => {
  it('cmdNew injects configured flags into the new-window command', () => {
    const prev = process.env.CX_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-home-'));
    process.env.CX_HOME = home;
    try {
      fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ claudeArgs: ['--permission-mode', 'bypassPermissions'] }));
      cmdNew({ purpose: 'flagged', dir: '/tmp', slug: 'fl', attach: false }, deps);
      expect(newWindowCalls.at(-1)!.command).toContain('--permission-mode');
      expect(newWindowCalls.at(-1)!.command).toContain('bypassPermissions');
    } finally {
      if (prev === undefined) delete process.env.CX_HOME; else process.env.CX_HOME = prev;
    }
  });

  it('cmdGo revive injects configured flags into the resume command', () => {
    const prev = process.env.CX_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-home-'));
    process.env.CX_HOME = home;
    try {
      fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ claudeArgs: ['--permission-mode', 'bypassPermissions'] }));
      cmdNew({ purpose: 'revivable', dir: '/tmp', slug: 'rv', attach: false }, deps);
      cmdDone({ slug: 'rv' }, deps);
      newWindowCalls = [];
      cmdGo({ slug: 'rv' }, deps);
      const call = newWindowCalls.at(-1)!;
      expect(call.command).toContain('--resume');
      expect(call.command).toContain('--permission-mode');
      expect(call.command).toContain('bypassPermissions');
    } finally {
      if (prev === undefined) delete process.env.CX_HOME; else process.env.CX_HOME = prev;
    }
  });

  it('cmdGo revive clears stale remoteUrl', () => {
    cmdNew({ purpose: 'has-remote', dir: '/tmp', slug: 'hr', attach: false }, deps);
    const reg = loadRegistry(regPath);
    const patched = { streams: reg.streams.map(s => s.slug === 'hr' ? { ...s, remoteUrl: 'https://claude.ai/code/session_stale', status: 'stopped' as const } : s) };
    fs.writeFileSync(regPath, JSON.stringify(patched, null, 2));
    newWindowCalls = [];
    cmdGo({ slug: 'hr' }, deps);
    expect(getStream(loadRegistry(regPath), 'hr')?.remoteUrl).toBeUndefined();
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

describe('cmdRestart', () => {
  function noAttachRunner(): Runner {
    const killedSlugs = new Set<string>();
    return {
      capture(_cmd, args) {
        if (args[0] === 'new-window') {
          const slug = args[args.indexOf('-n') + 1];
          const dir = args[args.indexOf('-c') + 1];
          const command = args[args.length - 1];
          newWindowCalls.push({ slug, dir, command });
          killedSlugs.delete(slug);
        }
        if (args[0] === 'kill-window') {
          const t = args[args.indexOf('-t') + 1];
          const slug = t.split(':').pop()!;
          killedSlugs.add(slug);
        }
        if (args[0] === 'list-windows') {
          const live = newWindowCalls.map(c => c.slug).filter(s => !killedSlugs.has(s));
          return { status: 0, stdout: live.join('\n') };
        }
        if (args[0] === 'display-message') return { status: 0, stdout: 'node' };
        return { status: 0, stdout: '' };
      },
      interactive() { throw new Error('restart must never attach'); },
    };
  }

  it('kills a live stream then background-revives it with --resume + sessionId', () => {
    const r = noAttachRunner();
    const localDeps: Deps = { regPath, runner: r };
    const s = cmdNew({ purpose: 'restartable', dir: '/tmp', slug: 'rs' }, localDeps);
    newWindowCalls = [];
    const result = cmdRestart({ slug: 'rs' }, localDeps);
    expect(result.restarted).toEqual(['rs']);
    const call = newWindowCalls.at(-1)!;
    expect(call.command).toContain('--resume');
    expect(call.command).toContain(s.sessionId);
    expect(getStream(loadRegistry(regPath), 'rs')?.status).toBe('running');
  });

  it('applies configured claudeArgs on restart', () => {
    const prev = process.env.CX_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-home-'));
    process.env.CX_HOME = home;
    try {
      fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ claudeArgs: ['--permission-mode', 'bypassPermissions'] }));
      const r = noAttachRunner();
      const localDeps: Deps = { regPath, runner: r };
      cmdNew({ purpose: 'cfg-restart', dir: '/tmp', slug: 'cfr' }, localDeps);
      newWindowCalls = [];
      cmdRestart({ slug: 'cfr' }, localDeps);
      const call = newWindowCalls.at(-1)!;
      expect(call.command).toContain('--permission-mode');
      expect(call.command).toContain('bypassPermissions');
    } finally {
      if (prev === undefined) delete process.env.CX_HOME; else process.env.CX_HOME = prev;
    }
  });

  it('clears stale remoteUrl on restart', () => {
    const r = noAttachRunner();
    const localDeps: Deps = { regPath, runner: r };
    cmdNew({ purpose: 'stale-url', dir: '/tmp', slug: 'su' }, localDeps);
    const reg = loadRegistry(regPath);
    const patched = { streams: reg.streams.map(s => s.slug === 'su' ? { ...s, remoteUrl: 'https://claude.ai/code/session_stale' } : s) };
    fs.writeFileSync(regPath, JSON.stringify(patched, null, 2));
    cmdRestart({ slug: 'su' }, localDeps);
    expect(getStream(loadRegistry(regPath), 'su')?.remoteUrl).toBeUndefined();
  });

  it('--all restarts only live streams, skips stopped ones', () => {
    const r = noAttachRunner();
    const localDeps: Deps = { regPath, runner: r };
    cmdNew({ purpose: 'live-one', dir: '/tmp', slug: 'live1' }, localDeps);
    cmdNew({ purpose: 'live-two', dir: '/tmp', slug: 'live2' }, localDeps);
    cmdDone({ slug: 'live2' }, localDeps);
    const callsBefore = newWindowCalls.length;
    const result = cmdRestart({ all: true }, localDeps);
    expect(result.restarted).toEqual(['live1']);
    const newCalls = newWindowCalls.slice(callsBefore);
    expect(newCalls.map(c => c.slug)).toContain('live1');
    expect(newCalls.map(c => c.slug)).not.toContain('live2');
  });

  it('restarts a stopped stream by slug (kill skipped, still revives)', () => {
    const r = noAttachRunner();
    const localDeps: Deps = { regPath, runner: r };
    cmdNew({ purpose: 'stopped-restart', dir: '/tmp', slug: 'sr' }, localDeps);
    cmdDone({ slug: 'sr' }, localDeps);
    newWindowCalls = [];
    const result = cmdRestart({ slug: 'sr' }, localDeps);
    expect(result.restarted).toEqual(['sr']);
    expect(newWindowCalls.at(-1)!.command).toContain('--resume');
    expect(getStream(loadRegistry(regPath), 'sr')?.status).toBe('running');
  });

  it('throws on unknown slug', () => {
    expect(() => cmdRestart({ slug: 'ghost' }, deps)).toThrow(/ghost/);
  });

  it('throws when neither slug nor --all given', () => {
    expect(() => cmdRestart({}, deps)).toThrow(/slug.*--all|--all.*slug/i);
  });
});
