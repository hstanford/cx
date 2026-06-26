import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  StreamSchema, loadRegistry, saveRegistry,
  addStream, getStream, updateStream, removeStream, sortStreams,
  type Stream,
} from './registry.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  file = path.join(dir, 'registry.json');
});

const sample = (over: Partial<Stream> = {}): Stream => StreamSchema.parse({
  slug: 'infra', sessionId: 'id-1', name: 'Infra', purpose: 'env cleanup',
  dir: '/tmp/x', status: 'running',
  createdAt: '2026-06-25T00:00:00.000Z', lastActiveAt: '2026-06-25T00:00:00.000Z',
  ...over,
});

describe('registry IO', () => {
  it('returns empty registry when file is missing', () => {
    expect(loadRegistry(file)).toEqual({ streams: [] });
  });

  it('round-trips through save/load', () => {
    const reg = addStream({ streams: [] }, sample());
    saveRegistry(file, reg);
    expect(loadRegistry(file)).toEqual(reg);
  });

  it('backs up and resets a corrupt file', () => {
    fs.writeFileSync(file, 'not json');
    expect(loadRegistry(file)).toEqual({ streams: [] });
    expect(fs.existsSync(file + '.bak')).toBe(true);
  });
});

describe('registry CRUD', () => {
  it('rejects duplicate slugs', () => {
    const reg = addStream({ streams: [] }, sample());
    expect(() => addStream(reg, sample())).toThrow(/slug/i);
  });

  it('updates and removes by slug', () => {
    let reg = addStream({ streams: [] }, sample());
    reg = updateStream(reg, 'infra', { status: 'stopped' });
    expect(getStream(reg, 'infra')?.status).toBe('stopped');
    reg = removeStream(reg, 'infra');
    expect(getStream(reg, 'infra')).toBeUndefined();
  });

  it('sorts running first, then most-recently-active', () => {
    const a = sample({ slug: 'a', status: 'stopped', lastActiveAt: '2026-06-25T03:00:00.000Z' });
    const b = sample({ slug: 'b', status: 'running', lastActiveAt: '2026-06-25T01:00:00.000Z' });
    const c = sample({ slug: 'c', status: 'running', lastActiveAt: '2026-06-25T02:00:00.000Z' });
    expect(sortStreams([a, b, c]).map(s => s.slug)).toEqual(['c', 'b', 'a']);
  });
});
