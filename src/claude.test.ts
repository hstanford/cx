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
  it('appends the seed prompt as the last positional', () => {
    expect(buildNewInvocation({ sessionId: 'id1', name: 'Trg', prompt: 'do the thing' })).toEqual([
      'claude', '--session-id', 'id1', '--remote-control', '--name', 'Trg', 'do the thing',
    ]);
  });
  it('omits the prompt when not given', () => {
    expect(buildNewInvocation({ sessionId: 'id1', name: 'Trg' })).toEqual([
      'claude', '--session-id', 'id1', '--remote-control', '--name', 'Trg',
    ]);
  });
  it('inserts --mcp-config before the prompt when given', () => {
    expect(buildNewInvocation({ sessionId: 'id1', name: 'Trg', mcpConfig: '/h/.cx/mcp.json', prompt: 'go' })).toEqual([
      'claude', '--session-id', 'id1', '--remote-control', '--name', 'Trg',
      '--mcp-config', '/h/.cx/mcp.json', 'go',
    ]);
  });
});
