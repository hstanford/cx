import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  loadRegistry, saveRegistry, addStream, sortStreams, getStream, updateStream, removeStream, type Stream, type Registry,
} from './registry.js';
import { slugify, uniqueSlug } from './slug.js';
import { shellJoin } from './shell.js';
import { buildNewInvocation, buildReviveInvocation } from './claude.js';
import { newWindow, attachWindow, killWindow, type Runner } from './tmux.js';
import { reconcile, isLive } from './liveness.js';
import { renderTable } from './render.js';
import { mcpConfigPath } from './mcp/config.js';
import { extractRemoteUrl } from './remoteUrl.js';
import { loadConfig } from './config.js';

export type Deps = { regPath: string; runner: Runner };

const nowIso = () => new Date().toISOString();

export function cmdNew(
  args: { purpose: string; dir: string; slug?: string; name?: string; seed?: string; attach?: boolean },
  deps: Deps,
): Stream {
  const reg = loadRegistry(deps.regPath);
  const name = args.name ?? args.purpose.slice(0, 40);
  const base = slugify(args.slug ?? name) || 'stream';
  const slug = uniqueSlug(base, reg.streams.map(s => s.slug));
  const sessionId = randomUUID();

  const stream: Stream = {
    slug, sessionId, name, purpose: args.purpose, dir: args.dir,
    status: 'running', createdAt: nowIso(), lastActiveAt: nowIso(),
  };

  const mcpConfig = fs.existsSync(mcpConfigPath()) ? mcpConfigPath() : undefined;
  const { claudeArgs } = loadConfig();
  const command = shellJoin(buildNewInvocation({ sessionId, name, prompt: args.seed, mcpConfig, extraArgs: claudeArgs }));
  newWindow(deps.runner, { slug, dir: args.dir, command });
  saveRegistry(deps.regPath, addStream(reg, stream));
  if (args.attach === true) attachWindow(deps.runner, slug);
  return stream;
}

export function listStreams(deps: Deps): Stream[] {
  const reg = reconcile(loadRegistry(deps.regPath), deps.runner);
  saveRegistry(deps.regPath, reg);
  return sortStreams(reg.streams);
}

export function cmdLs(deps: Deps, opts?: { archived?: boolean; all?: boolean }): string {
  const streams = listStreams(deps);
  let filtered: Stream[];
  if (opts?.all) {
    filtered = streams;
  } else if (opts?.archived) {
    filtered = streams.filter(s => s.archived === true);
  } else {
    filtered = streams.filter(s => !s.archived);
  }
  return renderTable(filtered);
}

export function cmdArchive(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);
  if (isLive(deps.runner, stream)) killWindow(deps.runner, args.slug);
  saveRegistry(deps.regPath, updateStream(reg, args.slug, { archived: true, status: 'stopped' }));
}

export function cmdRestore(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  if (!getStream(reg, args.slug)) throw new Error(`no stream "${args.slug}"`);
  saveRegistry(deps.regPath, updateStream(reg, args.slug, { archived: false }));
}

function reviveDetached(reg: Registry, stream: Stream, deps: Deps): Registry {
  const command = shellJoin(buildReviveInvocation({ sessionId: stream.sessionId, extraArgs: loadConfig().claudeArgs }));
  newWindow(deps.runner, { slug: stream.slug, dir: stream.dir, command });
  return updateStream(reg, stream.slug, { status: 'running', lastActiveAt: nowIso(), remoteUrl: undefined });
}

export function cmdGo(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);

  if (!isLive(deps.runner, stream)) {
    saveRegistry(deps.regPath, reviveDetached(reg, stream, deps));
  }
  attachWindow(deps.runner, args.slug);
}

export function cmdRestart(args: { slug?: string; all?: boolean }, deps: Deps): { restarted: string[] } {
  let reg = loadRegistry(deps.regPath);
  let targets: Stream[];
  if (args.all) {
    targets = reg.streams.filter(s => isLive(deps.runner, s));
  } else {
    if (!args.slug) throw new Error('restart needs a <slug> or --all');
    const s = getStream(reg, args.slug);
    if (!s) throw new Error(`no stream "${args.slug}"`);
    targets = [s];
  }
  for (const stream of targets) {
    if (isLive(deps.runner, stream)) killWindow(deps.runner, stream.slug);
    reg = reviveDetached(reg, stream, deps);
  }
  saveRegistry(deps.regPath, reg);
  return { restarted: targets.map(s => s.slug) };
}

export function cmdDone(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);
  killWindow(deps.runner, args.slug);
  saveRegistry(deps.regPath, updateStream(reg, args.slug, { status: 'stopped' }));
}

export function cmdEdit(
  args: { slug: string; purpose?: string; name?: string },
  deps: Deps,
): Stream {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);
  const patch: Partial<Stream> = {};
  if (args.purpose !== undefined) patch.purpose = args.purpose;
  if (args.name !== undefined) patch.name = args.name;
  const next = updateStream(reg, args.slug, patch);
  saveRegistry(deps.regPath, next);
  return getStream(next, args.slug)!;
}

export function cmdRm(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  if (!getStream(reg, args.slug)) throw new Error(`no stream "${args.slug}"`);
  killWindow(deps.runner, args.slug);
  saveRegistry(deps.regPath, removeStream(reg, args.slug));
}

export function cmdOpen(args: { slug: string }, deps: Deps): { opened: 'session' | 'list'; url: string } {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);
  let url = stream.remoteUrl;
  if (!url) {
    const pane = deps.runner.capture('tmux', ['capture-pane', '-p', '-S', '-', '-t', `cx:${stream.slug}`]);
    const found = pane.status === 0 ? extractRemoteUrl(pane.stdout) : undefined;
    if (found) {
      url = found;
      saveRegistry(deps.regPath, updateStream(reg, stream.slug, { remoteUrl: found }));
    }
  }
  if (url) {
    deps.runner.capture('open', [url]);
    return { opened: 'session', url };
  }
  const listUrl = 'https://claude.ai/code';
  deps.runner.capture('open', [listUrl]);
  return { opened: 'list', url: listUrl };
}
