import { cmdNew, listStreams, type Deps } from '../commands.js';

export function handleSpawn(
  args: { purpose: string; dir?: string; seed?: string },
  deps: Deps,
): { slug: string; sessionId: string; name: string } {
  const stream = cmdNew(
    { purpose: args.purpose, dir: args.dir ?? process.cwd(), seed: args.seed, attach: false },
    deps,
  );
  return { slug: stream.slug, sessionId: stream.sessionId, name: stream.name };
}

export function handleList(
  deps: Deps,
): Array<{ slug: string; name: string; purpose: string; status: string; dir: string }> {
  return listStreams(deps).filter(s => !s.archived).map(s => ({
    slug: s.slug, name: s.name, purpose: s.purpose, status: s.status, dir: s.dir,
  }));
}
