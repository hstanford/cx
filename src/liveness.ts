import { windowExists, paneCommand, SHELLS, type Runner } from './tmux.js';
import { updateStream, type Registry, type Stream } from './registry.js';

export function isLive(r: Runner, stream: Stream): boolean {
  if (!windowExists(r, stream.slug)) return false;
  const cmd = paneCommand(r, stream.slug);
  return cmd !== null && !SHELLS.has(cmd);
}

export function reconcile(reg: Registry, r: Runner): Registry {
  let next = reg;
  for (const s of reg.streams) {
    const status = isLive(r, s) ? 'running' : 'stopped';
    if (status !== s.status) next = updateStream(next, s.slug, { status });
  }
  return next;
}
