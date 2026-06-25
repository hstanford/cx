import { describe, it, expect } from 'vitest';
import { shellJoin } from './shell.js';

describe('shellJoin', () => {
  it('leaves safe tokens unquoted', () => {
    expect(shellJoin(['claude', '--resume', 'abc-123'])).toBe('claude --resume abc-123');
  });
  it('single-quotes tokens with spaces', () => {
    expect(shellJoin(['claude', '--name', 'Self serve'])).toBe("claude --name 'Self serve'");
  });
  it('escapes embedded single quotes', () => {
    expect(shellJoin(["it's"])).toBe("'it'\\''s'");
  });
});
