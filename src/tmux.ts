import { spawnSync } from 'node:child_process';

export const SESSION = 'cx';
const SHELLS = new Set(['zsh', 'bash', 'sh', '-zsh', '-bash', 'fish', 'tmux']);

export type Runner = {
  capture(cmd: string, args: string[]): { status: number; stdout: string };
  interactive(cmd: string, args: string[]): number;
};

export const defaultRunner: Runner = {
  capture(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout ?? '' };
  },
  interactive(cmd, args) {
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    return r.status ?? 1;
  },
};

const target = (slug: string) => `${SESSION}:${slug}`;

export function ensureSession(r: Runner): void {
  if (r.capture('tmux', ['has-session', '-t', SESSION]).status !== 0) {
    r.capture('tmux', ['new-session', '-d', '-s', SESSION, '-n', '__home']);
  }
}

export function windowExists(r: Runner, slug: string): boolean {
  const out = r.capture('tmux', ['list-windows', '-t', SESSION, '-F', '#{window_name}']);
  if (out.status !== 0) return false;
  return out.stdout.split('\n').map(s => s.trim()).includes(slug);
}

export function paneCommand(r: Runner, slug: string): string | null {
  const out = r.capture('tmux', ['display-message', '-p', '-t', target(slug), '#{pane_current_command}']);
  if (out.status !== 0) return null;
  const cmd = out.stdout.trim();
  return cmd === '' ? null : cmd;
}

// Liveness for EVERY window in one tmux call — `reconcile` checks the whole
// registry each poll, so this replaces its 2×N windowExists+paneCommand spawns
// with a single batched query. Returns window_name → active pane command.
export function liveWindows(r: Runner): Map<string, string> {
  const out = r.capture('tmux', ['list-windows', '-t', SESSION, '-F', '#{window_name}\t#{pane_current_command}']);
  const map = new Map<string, string>();
  if (out.status !== 0) return map;
  for (const line of out.stdout.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    map.set(line.slice(0, tab), line.slice(tab + 1).trim());
  }
  return map;
}

export function newWindow(r: Runner, opts: { slug: string; dir: string; command: string }): void {
  ensureSession(r);
  r.capture('tmux', [
    'new-window', '-t', SESSION, '-n', opts.slug, '-c', opts.dir, opts.command,
  ]);
}

export function killWindow(r: Runner, slug: string): void {
  r.capture('tmux', ['kill-window', '-t', target(slug)]);
}

export function attachWindow(r: Runner, slug: string): void {
  r.capture('tmux', ['select-window', '-t', target(slug)]);
  if (process.env.TMUX) {
    r.interactive('tmux', ['switch-client', '-t', target(slug)]);
  } else {
    r.interactive('tmux', ['attach-session', '-t', target(slug)]);
  }
}

export { SHELLS };
