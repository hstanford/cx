import { useEffect, useState } from 'react';
import { loadRegistry, saveRegistry, sortStreams, type Stream } from '../registry.js';
import { reconcile } from '../liveness.js';
import { type Deps } from '../commands.js';

export function readStreams(deps: Deps): Stream[] {
  const reg = reconcile(loadRegistry(deps.regPath), deps.runner);
  saveRegistry(deps.regPath, reg);
  return sortStreams(reg.streams);
}

export function useStreams(deps: Deps, intervalMs = 1000): Stream[] {
  const [streams, setStreams] = useState<Stream[]>(() => readStreams(deps));
  useEffect(() => {
    const id = setInterval(() => setStreams(readStreams(deps)), intervalMs);
    return () => clearInterval(id);
  }, [deps, intervalMs]);
  return streams;
}
