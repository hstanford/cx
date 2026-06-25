export function buildNewInvocation(opts: { sessionId: string; name: string; prompt?: string }): string[] {
  return [
    'claude', '--session-id', opts.sessionId, '--remote-control', '--name', opts.name,
    ...(opts.prompt ? [opts.prompt] : []),
  ];
}

export function buildReviveInvocation(opts: { sessionId: string }): string[] {
  return ['claude', '--remote-control', '--resume', opts.sessionId];
}
