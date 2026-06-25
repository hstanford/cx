import { randomUUID } from 'node:crypto';
import {
  loadRegistry, saveRegistry, addStream, sortStreams, getStream, updateStream, type Stream,
} from './registry.js';
import { slugify, uniqueSlug } from './slug.js';
import { shellJoin } from './shell.js';
import { buildNewInvocation, buildReviveInvocation } from './claude.js';
import { newWindow, attachWindow, killWindow, type Runner } from './tmux.js';
import { reconcile, isLive } from './liveness.js';
import { renderTable } from './render.js';

export type Deps = { regPath: string; runner: Runner };

const nowIso = () => new Date().toISOString();

export function cmdNew(
  args: { purpose: string; dir: string; slug?: string; name?: string },
  deps: Deps,
): Stream {
  const reg = loadRegistry(deps.regPath);
  const name = args.name ?? args.purpose.slice(0, 40);
  const base = slugify(args.slug ?? name);
  const slug = uniqueSlug(base, reg.streams.map(s => s.slug));
  const sessionId = randomUUID();

  const stream: Stream = {
    slug, sessionId, name, purpose: args.purpose, dir: args.dir,
    status: 'running', createdAt: nowIso(), lastActiveAt: nowIso(),
  };

  const command = shellJoin(buildNewInvocation({ sessionId, name }));
  newWindow(deps.runner, { slug, dir: args.dir, command });
  saveRegistry(deps.regPath, addStream(reg, stream));
  attachWindow(deps.runner, slug);
  return stream;
}

export function cmdLs(deps: Deps): string {
  const reg = reconcile(loadRegistry(deps.regPath), deps.runner);
  saveRegistry(deps.regPath, reg);
  return renderTable(sortStreams(reg.streams));
}

export function cmdGo(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);

  if (!isLive(deps.runner, stream)) {
    const command = shellJoin(buildReviveInvocation({ sessionId: stream.sessionId }));
    newWindow(deps.runner, { slug: stream.slug, dir: stream.dir, command });
    saveRegistry(deps.regPath, updateStream(reg, stream.slug, {
      status: 'running', lastActiveAt: nowIso(),
    }));
  }
  attachWindow(deps.runner, args.slug);
}

export function cmdDone(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);
  killWindow(deps.runner, args.slug);
  saveRegistry(deps.regPath, updateStream(reg, args.slug, { status: 'stopped' }));
}
