import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleSpawn, handleList } from './tools.js';
import { type Deps } from '../commands.js';

export function buildMcpServer(deps: Deps): McpServer {
  const server = new McpServer({ name: 'cx', version: '0.1.0' });

  server.registerTool(
    'cx_spawn',
    {
      description:
        'Fork a tangent into its own top-level Claude Code session (a cx stream). ' +
        'Use when the current thread is straddling two topics and the user consents to ' +
        'spin the tangent off. Creates a named, remote-controlled session seeded with the ' +
        'given context; the user opens it from claude.ai/code by name. Returns its identity.',
      inputSchema: {
        purpose: z.string().describe('One line: what this stream is for (becomes its name + memory).'),
        dir: z.string().optional().describe('Working directory for the session (defaults to the listener cwd).'),
        seed: z.string().optional().describe('Initial prompt / handoff brief the new session starts with.'),
      },
    },
    async ({ purpose, dir, seed }) => ({
      content: [{ type: 'text', text: JSON.stringify(handleSpawn({ purpose, dir, seed }, deps)) }],
    }),
  );

  server.registerTool(
    'cx_list',
    {
      description: 'List existing cx streams (running first) so you can avoid forking a duplicate.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(handleList(deps)) }] }),
  );

  return server;
}
