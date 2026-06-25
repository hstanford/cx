import { type Stream } from './registry.js';

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s.padEnd(n));

export function renderTable(streams: Stream[]): string {
  if (streams.length === 0) return 'no streams yet — `cx new "<purpose>"` to start one';
  return streams
    .map(s => {
      const dot = s.status === 'running' ? '●' : '○';
      return `${dot} ${pad(s.slug, 14)} ${pad(s.name, 20)} ${s.purpose}`;
    })
    .join('\n');
}
