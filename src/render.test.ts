import { describe, it, expect } from 'vitest';
import { renderTable } from './render.js';
import { StreamSchema, type Stream } from './registry.js';

const s = (over: Partial<Stream>): Stream => StreamSchema.parse({
  slug: 'infra', sessionId: 'id', name: 'Infra', purpose: 'render env',
  dir: '/tmp', status: 'running', createdAt: 'x', lastActiveAt: 'x', ...over,
});

describe('renderTable', () => {
  it('shows a filled dot for running and hollow for stopped, with slug + purpose', () => {
    const out = renderTable([s({ status: 'running', slug: 'a', purpose: 'live one' }),
                             s({ status: 'stopped', slug: 'b', purpose: 'idle one' })]);
    expect(out).toMatch(/●\s+a\b.*live one/);
    expect(out).toMatch(/○\s+b\b.*idle one/);
  });
  it('renders an empty-state line when there are no streams', () => {
    expect(renderTable([])).toMatch(/no streams/i);
  });
});
