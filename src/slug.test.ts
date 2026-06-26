import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from './slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Refactor Parser Module')).toBe('refactor-parser-module');
  });
  it('strips punctuation and collapses separators', () => {
    expect(slugify('Hot-fix: parser!!  now')).toBe('hot-fix-parser-now');
  });
  it('truncates to a sane length', () => {
    expect(slugify('a'.repeat(60)).length).toBeLessThanOrEqual(40);
  });
});

describe('uniqueSlug', () => {
  it('returns base when free', () => {
    expect(uniqueSlug('infra', [])).toBe('infra');
  });
  it('appends a counter when taken', () => {
    expect(uniqueSlug('infra', ['infra', 'infra-2'])).toBe('infra-3');
  });
});
