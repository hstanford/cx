import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const StreamSchema = z.object({
  slug: z.string(),
  sessionId: z.string(),
  name: z.string(),
  purpose: z.string(),
  dir: z.string(),
  status: z.enum(['running', 'stopped']),
  createdAt: z.string(),
  lastActiveAt: z.string(),
});
export type Stream = z.infer<typeof StreamSchema>;

export const RegistrySchema = z.object({ streams: z.array(StreamSchema) });
export type Registry = z.infer<typeof RegistrySchema>;

export function loadRegistry(file: string): Registry {
  if (!fs.existsSync(file)) return { streams: [] };
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return RegistrySchema.parse(JSON.parse(raw));
  } catch {
    fs.writeFileSync(file + '.bak', raw);
    return { streams: [] };
  }
}

export function saveRegistry(file: string, reg: Registry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, file);
}

export function addStream(reg: Registry, s: Stream): Registry {
  if (reg.streams.some(x => x.slug === s.slug)) {
    throw new Error(`a stream with slug "${s.slug}" already exists`);
  }
  return { streams: [...reg.streams, s] };
}

export function getStream(reg: Registry, slug: string): Stream | undefined {
  return reg.streams.find(s => s.slug === slug);
}

export function updateStream(reg: Registry, slug: string, patch: Partial<Stream>): Registry {
  return { streams: reg.streams.map(s => (s.slug === slug ? { ...s, ...patch } : s)) };
}

export function removeStream(reg: Registry, slug: string): Registry {
  return { streams: reg.streams.filter(s => s.slug !== slug) };
}

export function sortStreams(streams: Stream[]): Stream[] {
  const rank = (s: Stream) => (s.status === 'running' ? 0 : 1);
  return [...streams].sort(
    (a, b) => rank(a) - rank(b) || b.lastActiveAt.localeCompare(a.lastActiveAt),
  );
}
