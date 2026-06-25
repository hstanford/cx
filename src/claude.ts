export function buildNewInvocation(opts: { sessionId: string; name: string }): string[] {
  return ['claude', '--session-id', opts.sessionId, '--remote-control', '--name', opts.name];
}

export function buildReviveInvocation(opts: { sessionId: string }): string[] {
  return ['claude', '--remote-control', '--resume', opts.sessionId];
}
