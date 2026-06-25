import { describe, it, expect } from 'vitest';
import { isLive, reconcile } from './liveness.js';
import { StreamSchema, type Stream, type Registry } from './registry.js';
import { type Runner } from './tmux.js';

const stream = (over: Partial<Stream> = {}): Stream => StreamSchema.parse({
  slug: 'infra', sessionId: 'id', name: 'Infra', purpose: 'p', dir: '/tmp',
  status: 'running', createdAt: 'x', lastActiveAt: 'x', ...over,
});

function runnerWith(state: { exists: boolean; pane: string }): Runner {
  return {
    capture(_cmd, args) {
      if (args[0] === 'list-windows') return { status: 0, stdout: state.exists ? 'infra' : '' };
      if (args[0] === 'display-message') return { status: 0, stdout: state.pane };
      return { status: 0, stdout: '' };
    },
    interactive() { return 0; },
  };
}

describe('liveness', () => {
  it('is live when the window exists and the pane runs a non-shell command', () => {
    expect(isLive(runnerWith({ exists: true, pane: 'node' }), stream())).toBe(true);
  });
  it('is not live when the pane is just a shell', () => {
    expect(isLive(runnerWith({ exists: true, pane: 'zsh' }), stream())).toBe(false);
  });
  it('is not live when the window is gone', () => {
    expect(isLive(runnerWith({ exists: false, pane: '' }), stream())).toBe(false);
  });
  it('reconcile downgrades a dead "running" stream to stopped', () => {
    const reg: Registry = { streams: [stream({ status: 'running' })] };
    const out = reconcile(reg, runnerWith({ exists: false, pane: '' }));
    expect(out.streams[0].status).toBe('stopped');
  });
});
