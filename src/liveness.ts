import { SHELLS, liveWindows, type Runner } from './tmux.js';
import { updateStream, type Registry, type Stream } from './registry.js';

// Pure liveness check against a pre-fetched window→pane-command map: a stream is
// live when its window exists (present in the map) and the pane is running a
// real command, not just a shell.
function isLiveIn(live: Map<string, string>, slug: string): boolean {
  const cmd = live.get(slug);
  return cmd !== undefined && cmd !== '' && !SHELLS.has(cmd);
}

export function isLive(r: Runner, stream: Stream): boolean {
  return isLiveIn(liveWindows(r), stream.slug);
}

// One batched tmux query for the whole registry, not 2×N spawns. reconcile is
// the hot path (the TUI polls it every ~1s with spawnSync), so the per-stream
// windowExists + paneCommand calls were what made arrow input feel sluggish —
// they blocked the event loop ~10× a second.
export function reconcile(reg: Registry, r: Runner): Registry {
  const live = liveWindows(r);
  let next = reg;
  for (const s of reg.streams) {
    const status = isLiveIn(live, s.slug) ? 'running' : 'stopped';
    if (status !== s.status) next = updateStream(next, s.slug, { status });
  }
  return next;
}
