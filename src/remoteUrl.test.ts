import { describe, it, expect } from 'vitest';
import { extractRemoteUrl } from './remoteUrl.js';

describe('extractRemoteUrl', () => {
  it('returns the claude.ai URL from pane text', () => {
    const pane = 'Some startup text\nhttps://claude.ai/code/session_abc123xyz\nmore text';
    expect(extractRemoteUrl(pane)).toBe('https://claude.ai/code/session_abc123xyz');
  });

  it('returns the URL when surrounded by other content on the same line', () => {
    const pane = 'prefix https://claude.ai/code/s/tok suffix-word\nother line';
    expect(extractRemoteUrl(pane)).toBe('https://claude.ai/code/s/tok');
  });

  it('returns undefined when no claude.ai URL present', () => {
    const pane = 'Starting claude...\nSession ID: abc-123\nhttps://example.com/something';
    expect(extractRemoteUrl(pane)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractRemoteUrl('')).toBeUndefined();
  });
});
