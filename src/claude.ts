export function buildNewInvocation(
  opts: { sessionId: string; name: string; prompt?: string; mcpConfig?: string; extraArgs?: string[] },
): string[] {
  return [
    'claude', '--session-id', opts.sessionId, '--remote-control', '--name', opts.name,
    ...(opts.mcpConfig ? ['--mcp-config', opts.mcpConfig] : []),
    ...(opts.extraArgs ?? []),
    ...(opts.prompt ? [opts.prompt] : []),
  ];
}

export function buildReviveInvocation(opts: { sessionId: string; mcpConfig?: string; extraArgs?: string[] }): string[] {
  return [
    'claude', '--remote-control', '--resume', opts.sessionId,
    ...(opts.mcpConfig ? ['--mcp-config', opts.mcpConfig] : []),
    ...(opts.extraArgs ?? []),
  ];
}
