import { describe, it, expect } from 'vitest';
import {
  ensureSession, windowExists, paneCommand, newWindow, killWindow, type Runner,
} from './tmux.js';

function fakeRunner(): Runner & { calls: string[][] } {
  const windows = new Set<string>();
  const calls: string[][] = [];
  return {
    calls,
    capture(cmd, args) {
      calls.push([cmd, ...args]);
      if (args[0] === 'has-session') return { status: 0, stdout: '' };
      if (args[0] === 'list-windows') {
        return { status: 0, stdout: [...windows].join('\n') };
      }
      if (args[0] === 'display-message') return { status: 0, stdout: 'node' };
      if (args[0] === 'new-window') { windows.add(args[args.indexOf('-n') + 1]); return { status: 0, stdout: '' }; }
      if (args[0] === 'kill-window') { windows.delete(args[args.indexOf('-t') + 1].split(':')[1]); return { status: 0, stdout: '' }; }
      return { status: 0, stdout: '' };
    },
    interactive(cmd, args) { calls.push([cmd, ...args]); return 0; },
  };
}

describe('tmux driver', () => {
  it('creates a window in the cx session and reports it exists', () => {
    const r = fakeRunner();
    ensureSession(r);
    expect(windowExists(r, 'infra')).toBe(false);
    newWindow(r, { slug: 'infra', dir: '/tmp/x', command: 'claude --resume id' });
    expect(windowExists(r, 'infra')).toBe(true);
  });

  it('reads the pane command and kills the window', () => {
    const r = fakeRunner();
    newWindow(r, { slug: 'infra', dir: '/tmp/x', command: 'claude' });
    expect(paneCommand(r, 'infra')).toBe('node');
    killWindow(r, 'infra');
    expect(windowExists(r, 'infra')).toBe(false);
  });

  it('passes the command and start dir to new-window', () => {
    const r = fakeRunner();
    newWindow(r, { slug: 'infra', dir: '/tmp/x', command: 'claude --remote-control' });
    const call = r.calls.find(c => c[1] === 'new-window')!;
    expect(call).toContain('/tmp/x');
    expect(call).toContain('claude --remote-control');
  });
});
