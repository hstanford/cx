import { describe, it, expect } from 'vitest';
import { buildNewInvocation, buildReviveInvocation } from './claude.js';

describe('claude invocations', () => {
  it('pins the session id, remote control and name on new', () => {
    expect(buildNewInvocation({ sessionId: 'uuid-1', name: 'Triggers' })).toEqual([
      'claude', '--session-id', 'uuid-1', '--remote-control', '--name', 'Triggers',
    ]);
  });
  it('revives with remote control + resume by id', () => {
    expect(buildReviveInvocation({ sessionId: 'uuid-1' })).toEqual([
      'claude', '--remote-control', '--resume', 'uuid-1',
    ]);
  });
});
