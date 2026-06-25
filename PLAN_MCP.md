# cx — `cx listen` + MCP surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an idempotent `cx listen` command that runs a local HTTP MCP server exposing `cx_spawn` and `cx_list`, so a running Claude Code session can — with consent — fork a tangent into its own top-level, remote-controlled cx stream.

**Architecture:** A fourth front-end over the same registry/command core. `cx listen` serves one stateless Streamable-HTTP MCP endpoint (`@modelcontextprotocol/sdk`). Tool handlers call the existing `cmdNew`/list functions. cx-spawned sessions launch with `--mcp-config ~/.cx/mcp.json` so they inherit the cx tools (recursion). The daemon is stateless beyond the registry and idempotent (bind-or-bail).

**Tech Stack:** TypeScript (ESM), Node `http`, `@modelcontextprotocol/sdk@^1.29.0`, zod, vitest. Builds on the completed core (registry, commands, tmux, liveness, CLI, TUI).

## Global Constraints

- **Interactive `claude --remote-control` only, never `-p`.** MCP spawns create the session **detached** (no terminal handoff in the daemon) — the user attaches later via the app or `cx go`.
- **Stateless, thin daemon.** `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`. No background reconciliation, no per-session state. Tools call the same stateless functions.
- **Idempotent `cx listen`.** Bind `127.0.0.1:<port>` (default `7591`, override `CX_PORT`); on `EADDRINUSE`, print "already listening" and exit 0.
- **Non-invasive wiring.** `cx listen` writes a cx-scoped `~/.cx/mcp.json` (`{ mcpServers: { cx: { type: "http", url: "http://127.0.0.1:<port>/mcp" } } }`). cx-spawned sessions get `--mcp-config ~/.cx/mcp.json` when that file exists. We do NOT edit the user's global Claude config.
- **SDK API (verified, v1.29.0):** `new McpServer({ name, version })`; `server.registerTool(name, { description, inputSchema: <rawZodShape> }, async (args) => ({ content: [{ type: 'text', text }] }))` (throw or `isError:true` on failure); `await server.connect(transport)`; `transport.handleRequest(req, res)` on `POST /mcp`.
- **Flag ordering:** `--remote-control` takes an *optional* value, so the seed prompt must be the LAST positional and must never sit immediately after `--remote-control` (keep `--name`/`--session-id` between them).
- ESM, TS strict, vitest, colocated tests, pristine output. Build + full suite green before each commit.

---

### Task M1: Seed + detached spawn (`buildNewInvocation` prompt, `cmdNew` seed/attach)

**Files:**
- Modify: `src/claude.ts`, `src/claude.test.ts`, `src/commands.ts`, `src/commands.test.ts`

**Interfaces:**
- Produces:
  - `buildNewInvocation(opts: { sessionId: string; name: string; prompt?: string }): string[]` (now appends `prompt` last when present)
  - `cmdNew(args: { purpose: string; dir: string; slug?: string; name?: string; seed?: string; attach?: boolean }, deps: Deps): Stream` (`seed` → claude initial prompt; `attach` defaults `true`, when `false` the tmux window is created but NOT attached)

- [ ] **Step 1: Add failing tests to `src/claude.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/claude.test.ts`
Expected: FAIL — prompt not appended.

- [ ] **Step 3: Update `src/claude.ts` `buildNewInvocation`**

```ts
export function buildNewInvocation(opts: { sessionId: string; name: string; prompt?: string }): string[] {
  return [
    'claude', '--session-id', opts.sessionId, '--remote-control', '--name', opts.name,
    ...(opts.prompt ? [opts.prompt] : []),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/claude.test.ts`
Expected: PASS.

- [ ] **Step 5: Add failing tests to `src/commands.test.ts`**

```ts
describe('cmdNew seed + attach', () => {
  it('passes the seed as the claude initial prompt', () => {
    const s = cmdNew({ purpose: 'tangent', dir: '/tmp', slug: 'tg', seed: 'continue the tangent' }, deps);
    const call = newWindowCalls.at(-1)!;
    expect(call.command).toContain('continue the tangent');
    expect(s.slug).toBe('tg');
  });
  it('does NOT attach when attach:false (no interactive call)', () => {
    let interactiveCalls = 0;
    const r: Runner = {
      capture: deps.runner.capture,
      interactive: () => { interactiveCalls++; return 0; },
    };
    cmdNew({ purpose: 'detached', dir: '/tmp', slug: 'det', attach: false }, { regPath, runner: r });
    expect(interactiveCalls).toBe(0);
  });
});
```

> The `recordingRunner` from earlier tasks records `new-window` calls into `newWindowCalls`; reuse it. The second test swaps in a runner whose `interactive` counts calls to assert detached creation.

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/commands.test.ts`
Expected: FAIL — `seed`/`attach` not handled.

- [ ] **Step 7: Update `src/commands.ts` `cmdNew`**

Change the signature and body so `seed` flows into `buildNewInvocation` and `attach` gates the attach call:

```ts
export function cmdNew(
  args: { purpose: string; dir: string; slug?: string; name?: string; seed?: string; attach?: boolean },
  deps: Deps,
): Stream {
  const reg = loadRegistry(deps.regPath);
  const name = args.name ?? args.purpose.slice(0, 40);
  const base = slugify(args.slug ?? name);
  const slug = uniqueSlug(base, reg.streams.map(s => s.slug));
  const sessionId = randomUUID();

  const stream: Stream = {
    slug, sessionId, name, purpose: args.purpose, dir: args.dir,
    status: 'running', createdAt: nowIso(), lastActiveAt: nowIso(),
  };

  const command = shellJoin(buildNewInvocation({ sessionId, name, prompt: args.seed }));
  newWindow(deps.runner, { slug, dir: args.dir, command });
  saveRegistry(deps.regPath, addStream(reg, stream));
  if (args.attach !== false) attachWindow(deps.runner, slug);
  return stream;
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test src/claude.test.ts src/commands.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: cmdNew seed (initial prompt) + detached spawn (attach flag)"
```

---

### Task M2: MCP tool handlers + shared `listStreams`

**Files:**
- Modify: `src/commands.ts`, `src/commands.test.ts`
- Create: `src/mcp/tools.ts`, `src/mcp/tools.test.ts`

**Interfaces:**
- Produces:
  - `listStreams(deps: Deps): Stream[]` (in `commands.ts`: load → reconcile → save → sort; `cmdLs` is refactored to render this)
  - `handleSpawn(args: { purpose: string; dir?: string; seed?: string }, deps: Deps): { slug: string; sessionId: string; name: string }`
  - `handleList(deps: Deps): Array<{ slug: string; name: string; purpose: string; status: string; dir: string }>`

- [ ] **Step 1: Add a failing test to `src/commands.test.ts`**

```ts
describe('listStreams', () => {
  it('returns reconciled, sorted streams (running first)', () => {
    cmdNew({ purpose: 'one', dir: '/tmp', slug: 'one', attach: false }, deps);
    const streams = listStreams(deps);
    expect(streams).toHaveLength(1);
    expect(streams[0].slug).toBe('one');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/commands.test.ts`
Expected: FAIL — `listStreams` not exported.

- [ ] **Step 3: Add `listStreams` to `src/commands.ts` and refactor `cmdLs`**

```ts
export function listStreams(deps: Deps): Stream[] {
  const reg = reconcile(loadRegistry(deps.regPath), deps.runner);
  saveRegistry(deps.regPath, reg);
  return sortStreams(reg.streams);
}

export function cmdLs(deps: Deps): string {
  return renderTable(listStreams(deps));
}
```

(`reconcile`, `sortStreams`, `renderTable`, `loadRegistry`, `saveRegistry` are already imported in `commands.ts`. Remove any now-unused duplicate logic from the old `cmdLs` body.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/commands.test.ts`
Expected: PASS (existing `cmdLs` test still green).

- [ ] **Step 5: Write the failing test — `src/mcp/tools.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { handleSpawn, handleList } from './tools.js';
import { type Deps } from '../commands.js';
import { loadRegistry } from '../registry.js';
import { type Runner } from '../tmux.js';

const runner: Runner = {
  capture(_c, args) {
    if (args[0] === 'list-windows') return { status: 0, stdout: '' }; // nothing live
    return { status: 0, stdout: '' };
  },
  interactive() { throw new Error('MCP spawn must not attach (interactive called)'); },
};

let deps: Deps;
let regPath: string;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  regPath = path.join(dir, 'registry.json');
  deps = { regPath, runner };
});

describe('handleSpawn', () => {
  it('creates a detached stream and returns its identity', () => {
    const out = handleSpawn({ purpose: 'fork this tangent', seed: 'pick up X' }, deps);
    expect(out.slug).toBeTruthy();
    expect(out.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(loadRegistry(regPath).streams).toHaveLength(1);
  });
});

describe('handleList', () => {
  it('returns the streams as structured rows', () => {
    handleSpawn({ purpose: 'one', dir: '/tmp' }, deps);
    const rows = handleList(deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty('purpose', 'one');
    expect(rows[0]).toHaveProperty('status');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/mcp/tools.test.ts`
Expected: FAIL — cannot resolve `./tools.js`.

- [ ] **Step 7: Implement `src/mcp/tools.ts`**

```ts
import { cmdNew, listStreams, type Deps } from '../commands.js';

export function handleSpawn(
  args: { purpose: string; dir?: string; seed?: string },
  deps: Deps,
): { slug: string; sessionId: string; name: string } {
  const stream = cmdNew(
    { purpose: args.purpose, dir: args.dir ?? process.cwd(), seed: args.seed, attach: false },
    deps,
  );
  return { slug: stream.slug, sessionId: stream.sessionId, name: stream.name };
}

export function handleList(
  deps: Deps,
): Array<{ slug: string; name: string; purpose: string; status: string; dir: string }> {
  return listStreams(deps).map(s => ({
    slug: s.slug, name: s.name, purpose: s.purpose, status: s.status, dir: s.dir,
  }));
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test src/mcp/tools.test.ts src/commands.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: MCP tool handlers (spawn detached + list) + shared listStreams"
```

---

### Task M3: MCP server, `cx listen` daemon, config file

**Files:**
- Modify: `package.json` (add `@modelcontextprotocol/sdk`), `bin/cx.ts`
- Create: `src/mcp/config.ts`, `src/mcp/config.test.ts`, `src/mcp/server.ts`, `src/listen.ts`, `src/listen.test.ts`

**Interfaces:**
- Produces:
  - `cxPort(): number`, `mcpConfigPath(): string`, `mcpUrl(port: number): string`, `writeMcpConfig(port: number): void`
  - `buildMcpServer(deps: Deps): McpServer`
  - `createCxHttpServer(deps: Deps): Promise<http.Server>` (in `listen.ts`)
  - `listen(deps: Deps, opts?: { port?: number }): Promise<void>` (idempotent)

- [ ] **Step 1: Add the SDK dependency**

Edit `package.json` dependencies: add `"@modelcontextprotocol/sdk": "^1.29.0"` and ensure `"zod": "^3.25.0"` (the SDK peer wants `^3.25 || ^4`).

Run: `pnpm install`
Expected: installs cleanly.

- [ ] **Step 2: Write the failing test — `src/mcp/config.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { cxPort, mcpConfigPath, mcpUrl, writeMcpConfig } from './config.js';

let home: string;
let prevHome: string | undefined;
let prevPort: string | undefined;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  prevHome = process.env.CX_HOME; prevPort = process.env.CX_PORT;
  process.env.CX_HOME = home; delete process.env.CX_PORT;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.CX_HOME; else process.env.CX_HOME = prevHome;
  if (prevPort === undefined) delete process.env.CX_PORT; else process.env.CX_PORT = prevPort;
});

describe('mcp config', () => {
  it('defaults the port to 7591 and honors CX_PORT', () => {
    expect(cxPort()).toBe(7591);
    process.env.CX_PORT = '9000';
    expect(cxPort()).toBe(9000);
  });
  it('builds the loopback /mcp url', () => {
    expect(mcpUrl(7591)).toBe('http://127.0.0.1:7591/mcp');
  });
  it('writes a valid .mcp.json describing the cx http server', () => {
    writeMcpConfig(7591);
    const body = JSON.parse(fs.readFileSync(mcpConfigPath(), 'utf8'));
    expect(body).toEqual({ mcpServers: { cx: { type: 'http', url: 'http://127.0.0.1:7591/mcp' } } });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/mcp/config.test.ts`
Expected: FAIL — cannot resolve `./config.js`.

- [ ] **Step 4: Implement `src/mcp/config.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { cxHome } from '../paths.js';

export function cxPort(): number {
  const p = process.env.CX_PORT;
  return p ? Number(p) : 7591;
}

export function mcpConfigPath(): string {
  return path.join(cxHome(), 'mcp.json');
}

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export function writeMcpConfig(port: number): void {
  const file = mcpConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = { mcpServers: { cx: { type: 'http', url: mcpUrl(port) } } };
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/mcp/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement `src/mcp/server.ts`**

```ts
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
```

- [ ] **Step 7: Implement `src/listen.ts`**

```ts
import { createServer, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp/server.js';
import { writeMcpConfig, cxPort, mcpUrl } from './mcp/config.js';
import { type Deps } from './commands.js';

export async function createCxHttpServer(deps: Deps): Promise<Server> {
  const mcp = buildMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  return createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/mcp') {
      transport.handleRequest(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
    } else {
      res.writeHead(404).end();
    }
  });
}

export async function listen(deps: Deps, opts: { port?: number } = {}): Promise<void> {
  const port = opts.port ?? cxPort();
  const httpServer = await createCxHttpServer(deps);
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`cx listen: already listening on ${mcpUrl(port)}`);
        resolve();
      } else {
        reject(err);
      }
    });
    httpServer.listen(port, '127.0.0.1', () => {
      writeMcpConfig(port);
      console.log(`cx listen: serving MCP on ${mcpUrl(port)}`);
      resolve();
    });
  });
}
```

> The listening server keeps the Node event loop alive, so `bin/cx.ts` returning after `await listen()` does not exit the process while serving. On `EADDRINUSE` no server is held open, so the process exits 0 (idempotent).

- [ ] **Step 8: Write the failing integration test — `src/listen.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { createCxHttpServer } from './listen.js';
import { type Deps } from './commands.js';
import { type Runner } from './tmux.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const runner: Runner = {
  capture(_c, args) { return { status: 0, stdout: args[0] === 'list-windows' ? '' : '' }; },
  interactive() { return 0; },
};

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  deps = { regPath: path.join(dir, 'registry.json'), runner };
});

describe('cx MCP server over HTTP', () => {
  it('exposes cx_spawn and cx_list to an MCP client', async () => {
    const httpServer = await createCxHttpServer(deps);
    await new Promise<void>(r => httpServer.listen(0, '127.0.0.1', r));
    const port = (httpServer.address() as AddressInfo).port;

    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    expect(names).toContain('cx_spawn');
    expect(names).toContain('cx_list');

    await client.close();
    await new Promise<void>(r => httpServer.close(() => r()));
  });
});
```

- [ ] **Step 9: Run test to verify it passes** (it fails first against the not-yet-existing `listen.ts`, then passes once Steps 6–7 are in)

Run: `pnpm test src/listen.test.ts`
Expected: PASS — both tools listed over a real HTTP MCP round-trip.

- [ ] **Step 10: Wire `cx listen` into `bin/cx.ts`**

Replace the body so `deps` is built once (also fixes the prior double-`registryPath()` note) and `listen` is handled before `runCli`:

```ts
#!/usr/bin/env node
import { runCli } from '../src/cli.js';
import { registryPath } from '../src/paths.js';
import { defaultRunner } from '../src/tmux.js';
import { launchTui } from '../src/tui/launch.js';
import { listen } from '../src/listen.js';

const deps = { regPath: registryPath(), runner: defaultRunner };

try {
  if (process.argv[2] === 'listen') {
    await listen(deps);
  } else {
    const res = runCli(process.argv.slice(2), deps);
    if (res.launchTui) {
      await launchTui(deps);
    } else if (res.output) {
      console.log(res.output);
    }
  }
} catch (err) {
  console.error(`cx: ${(err as Error).message}`);
  process.exit(1);
}
```

- [ ] **Step 11: Build + full suite**

Run: `pnpm build && pnpm test`
Expected: `tsc` clean; ALL tests pass, output pristine.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: cx listen — idempotent HTTP MCP server (cx_spawn, cx_list) + mcp.json"
```

---

### Task M4: Spawned-session wiring (`--mcp-config`) + docs

**Files:**
- Modify: `src/claude.ts`, `src/claude.test.ts`, `src/commands.ts`, `src/commands.test.ts`, `README.md`

**Interfaces:**
- Produces:
  - `buildNewInvocation(opts: { sessionId: string; name: string; prompt?: string; mcpConfig?: string }): string[]` (adds `--mcp-config <path>` before the prompt when `mcpConfig` is set)
  - `cmdNew` passes `mcpConfig: mcpConfigPath()` when that file exists, so spawned sessions inherit the cx tools.

- [ ] **Step 1: Add a failing test to `src/claude.test.ts`**

```ts
it('inserts --mcp-config before the prompt when given', () => {
  expect(buildNewInvocation({ sessionId: 'id1', name: 'Trg', mcpConfig: '/h/.cx/mcp.json', prompt: 'go' })).toEqual([
    'claude', '--session-id', 'id1', '--remote-control', '--name', 'Trg',
    '--mcp-config', '/h/.cx/mcp.json', 'go',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/claude.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `buildNewInvocation`**

```ts
export function buildNewInvocation(
  opts: { sessionId: string; name: string; prompt?: string; mcpConfig?: string },
): string[] {
  return [
    'claude', '--session-id', opts.sessionId, '--remote-control', '--name', opts.name,
    ...(opts.mcpConfig ? ['--mcp-config', opts.mcpConfig] : []),
    ...(opts.prompt ? [opts.prompt] : []),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/claude.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a failing test to `src/commands.test.ts`**

```ts
describe('cmdNew mcp wiring', () => {
  it('adds --mcp-config when ~/.cx/mcp.json exists', () => {
    const prev = process.env.CX_HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-home-'));
    process.env.CX_HOME = home;
    try {
      fs.writeFileSync(path.join(home, 'mcp.json'), '{}');
      cmdNew({ purpose: 'wired', dir: '/tmp', slug: 'wired', attach: false }, deps);
      expect(newWindowCalls.at(-1)!.command).toContain('--mcp-config');
    } finally {
      if (prev === undefined) delete process.env.CX_HOME; else process.env.CX_HOME = prev;
    }
  });
});
```

> `fs`, `os`, `path` are already imported at the top of `commands.test.ts`. `deps.regPath` points at a temp dir from `beforeEach`; this test additionally points `CX_HOME` at a temp home holding `mcp.json`.

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/commands.test.ts`
Expected: FAIL — no `--mcp-config` added.

- [ ] **Step 7: Update `cmdNew` in `src/commands.ts`**

Add imports (merge into existing groups; `fs` is `node:fs`):

```ts
import fs from 'node:fs';
import { mcpConfigPath } from './mcp/config.js';
```

In `cmdNew`, compute the optional mcp-config and pass it through:

```ts
  const mcpConfig = fs.existsSync(mcpConfigPath()) ? mcpConfigPath() : undefined;
  const command = shellJoin(buildNewInvocation({ sessionId, name, prompt: args.seed, mcpConfig }));
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test src/commands.test.ts src/claude.test.ts`
Expected: PASS.

- [ ] **Step 9: Update `README.md`** — append an MCP section

```markdown
## Agent dispatch (`cx listen`)

`cx listen` runs a local MCP server (default `http://127.0.0.1:7591/mcp`, override `CX_PORT`)
so a running Claude Code session can fork a tangent into its own stream — with your consent.

    cx listen        # start the idempotent MCP daemon (safe to run repeatedly)

Tools exposed: `cx_spawn({ purpose, dir?, seed? })` (creates a detached, remote-controlled
stream seeded with a handoff brief) and `cx_list()`.

- Sessions started by cx automatically get the `cx` tools (cx writes `~/.cx/mcp.json` and
  launches spawned sessions with `--mcp-config ~/.cx/mcp.json`).
- To give a session you started manually the same tools, add the server once:

      claude mcp add --transport http cx http://127.0.0.1:7591/mcp

cx does not edit your global Claude config. The daemon is stateless beyond the registry and
disposable — kill it and re-run `cx listen` anytime.
```

- [ ] **Step 10: Build + full suite gate**

Run: `pnpm build && pnpm test`
Expected: `tsc` clean; ALL tests pass.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: spawned sessions inherit cx MCP tools via --mcp-config; docs"
```

---

## Real-path verification (folded into the final pass, with Henry)

After M4, before merge — verify against the real binary + a real session:

1. `cx listen` → prints "serving MCP on http://127.0.0.1:7591/mcp"; `~/.cx/mcp.json` exists with the right body.
2. Run `cx listen` again in another terminal → "already listening" + exits 0 (idempotent).
3. `claude --mcp-config ~/.cx/mcp.json -p "use cx_list"` → returns the current streams as JSON.
4. From a cx-spawned (or `--mcp-config`-wired) interactive session, ask it to `cx_spawn` a tangent → a new stream appears in `cx ls`, opens in claude.ai/code by name, and its first message is the seed.
5. Confirm the seed prompt is NOT swallowed by `--remote-control` (the new session's first turn is the seed text, not a session named after it).

## Self-Review

- Seed (`cmdNew.seed` → initial prompt) → M1. Detached spawn (`attach:false`) → M1. Both required by MCP.
- Tools `cx_spawn`/`cx_list` over the command core → M2; `listStreams` shared by `cmdLs` + `handleList` (DRY).
- Stateless HTTP MCP server + idempotent `cx listen` + `~/.cx/mcp.json` → M3; HTTP round-trip integration-tested via the SDK client.
- Non-invasive wiring (`--mcp-config` when the file exists) + manual opt-in docs → M4.
- Global constraints (never `-p`, stateless/thin daemon, flag ordering with prompt last) honored throughout.
- **Known deferrals (no silent caps):** the live daemon's behavior under a real `claude` session is verified in the real-path pass, not unit tests (the unit test covers the HTTP tool-listing round-trip only). Capturing the exact remote-control URL to return from `cx_spawn` is out of scope (return identity; user opens by name). `done`/`go` MCP tools deferred (YAGNI).
