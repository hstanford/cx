import { useEffect, useRef, useState } from 'react';
import { loadRegistry, sortStreams, type Stream } from '../registry.js';
import { reconcile } from '../liveness.js';
import { type Deps } from '../commands.js';

// READ-ONLY. The poll loop (every ~1s) must never write the registry: status is
// re-derived from tmux on every load anyway, so persisting it is redundant — and
// a load→reconcile→save here is a non-atomic read-modify-write that clobbers
// streams a concurrent `cx new` adds in the gap (the reconcile shells out to
// tmux per stream, so the window is tens-to-hundreds of ms, every second).
// Only genuine mutations (new/done/archive/…) write.
export function readStreams(deps: Deps): Stream[] {
  const reg = reconcile(loadRegistry(deps.regPath), deps.runner);
  return sortStreams(reg.streams);
}

export function useStreams(deps: Deps, intervalMs = 1000): Stream[] {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [streams, setStreams] = useState<Stream[]>(() => readStreams(deps));
  useEffect(() => {
    const id = setInterval(() => setStreams(readStreams(depsRef.current)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return streams;
}
