# cx Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A laptop-side CLI + live TUI that manages many concurrent Claude Code sessions through one durable registry, launching each already remote-controlled and named, and making session close fearless.

**Architecture:** One JSON registry at `~/.cx/registry.json` is the source of truth. Pure modules (slug, registry CRUD, invocation builders, shell-quoting) sit under a thin tmux driver and a liveness reconciler. Command functions compose those; a CLI dispatcher and an ink TUI are two front-ends over the same command layer. Liveness is derived from local tmux/process state, never trusted from a stored flag.

**Tech Stack:** TypeScript (ESM), Node ≥18, zod (registry validation), ink + react (TUI), vitest (tests), tmux + the `claude` CLI (driven via `child_process`).

## Global Constraints

- **Interactive only, never `-p`.** Every spawned session is interactive `claude --remote-control …` inside a tmux window. No headless `-p` anywhere.
- **Join Claude by `sessionId` (UUID), not name.** Pin it with `--session-id <uuid>` at creation; revive with `--resume <uuid>`. Names are free-form; only `slug` is unique.
- **Registry path is `~/.cx/registry.json`**, overridable via `CX_HOME` env var (used by tests). Never inside the code dir.
- **Liveness is derived ground truth** — tmux window exists AND its pane is running a non-shell command. No Claude API is queried (none exists).
- **Atomic registry writes** — write to a temp file then rename; validate on read; back up a corrupt file rather than overwrite.
- **All session windows live in one tmux session named `cx`.**
- Module style: ESM, `.ts`/`.tsx`, colocated `*.test.ts` files, `crypto.randomUUID()` for ids (no uuid dep).

---

### Task 1: Project scaffold + `slug` module

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (exists — verify), `src/slug.ts`, `src/slug.test.ts`

**Interfaces:**
- Produces: `slugify(input: string): string`, `uniqueSlug(base: string, taken: string[]): string`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "cx",
  "version": "0.1.0",
  "description": "Control plane for many Claude Code sessions",
  "type": "module",
  "bin": { "cx": "dist/bin/cx.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "ink": "^5.0.1",
    "ink-text-input": "^6.0.0",
    "react": "^18.3.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "ink-testing-library": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false
  },
  "include": ["bin", "src"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
```

- [ ] **Step 4: Install and verify `.gitignore` contains `node_modules/`, `dist/`, `.cx/`**

Run: `pnpm install`
Expected: installs without error. Confirm `.gitignore` already lists `node_modules/`, `dist/`, `.cx/` (created during design); add any missing.

- [ ] **Step 5: Write the failing test — `src/slug.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from './slug.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Triggers Page Refresh')).toBe('triggers-page-refresh');
  });
  it('strips punctuation and collapses separators', () => {
    expect(slugify('Self-serve: launch!!  now')).toBe('self-serve-launch-now');
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/slug.test.ts`
Expected: FAIL — cannot resolve `./slug.js`.

- [ ] **Step 7: Implement `src/slug.ts`**

```ts
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function uniqueSlug(base: string, taken: string[]): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test src/slug.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold + slug module"
```

---

### Task 2: `paths` + `registry` (schema, IO, CRUD)

**Files:**
- Create: `src/paths.ts`, `src/registry.ts`, `src/registry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `cxHome(): string`, `registryPath(): string`
  - `Stream` (type), `StreamSchema`, `Registry` (type), `RegistrySchema`
  - `loadRegistry(path: string): Registry`
  - `saveRegistry(path: string, reg: Registry): void`
  - `addStream(reg: Registry, s: Stream): Registry` (throws on duplicate slug)
  - `getStream(reg: Registry, slug: string): Stream | undefined`
  - `updateStream(reg: Registry, slug: string, patch: Partial<Stream>): Registry`
  - `removeStream(reg: Registry, slug: string): Registry`
  - `sortStreams(streams: Stream[]): Stream[]` (running first, then `lastActiveAt` desc)

- [ ] **Step 1: Implement `src/paths.ts`** (trivial, no separate test)

```ts
import os from 'node:os';
import path from 'node:path';

export function cxHome(): string {
  return process.env.CX_HOME ?? path.join(os.homedir(), '.cx');
}

export function registryPath(): string {
  return path.join(cxHome(), 'registry.json');
}
```

- [ ] **Step 2: Write the failing test — `src/registry.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  StreamSchema, loadRegistry, saveRegistry,
  addStream, getStream, updateStream, removeStream, sortStreams,
  type Stream,
} from './registry.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  file = path.join(dir, 'registry.json');
});

const sample = (over: Partial<Stream> = {}): Stream => StreamSchema.parse({
  slug: 'infra', sessionId: 'id-1', name: 'Infra', purpose: 'render env',
  dir: '/tmp/x', status: 'running',
  createdAt: '2026-06-25T00:00:00.000Z', lastActiveAt: '2026-06-25T00:00:00.000Z',
  ...over,
});

describe('registry IO', () => {
  it('returns empty registry when file is missing', () => {
    expect(loadRegistry(file)).toEqual({ streams: [] });
  });

  it('round-trips through save/load', () => {
    const reg = addStream({ streams: [] }, sample());
    saveRegistry(file, reg);
    expect(loadRegistry(file)).toEqual(reg);
  });

  it('backs up and resets a corrupt file', () => {
    fs.writeFileSync(file, 'not json');
    expect(loadRegistry(file)).toEqual({ streams: [] });
    expect(fs.existsSync(file + '.bak')).toBe(true);
  });
});

describe('registry CRUD', () => {
  it('rejects duplicate slugs', () => {
    const reg = addStream({ streams: [] }, sample());
    expect(() => addStream(reg, sample())).toThrow(/slug/i);
  });

  it('updates and removes by slug', () => {
    let reg = addStream({ streams: [] }, sample());
    reg = updateStream(reg, 'infra', { status: 'stopped' });
    expect(getStream(reg, 'infra')?.status).toBe('stopped');
    reg = removeStream(reg, 'infra');
    expect(getStream(reg, 'infra')).toBeUndefined();
  });

  it('sorts running first, then most-recently-active', () => {
    const a = sample({ slug: 'a', status: 'stopped', lastActiveAt: '2026-06-25T03:00:00.000Z' });
    const b = sample({ slug: 'b', status: 'running', lastActiveAt: '2026-06-25T01:00:00.000Z' });
    const c = sample({ slug: 'c', status: 'running', lastActiveAt: '2026-06-25T02:00:00.000Z' });
    expect(sortStreams([a, b, c]).map(s => s.slug)).toEqual(['c', 'b', 'a']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/registry.test.ts`
Expected: FAIL — cannot resolve `./registry.js`.

- [ ] **Step 4: Implement `src/registry.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const StreamSchema = z.object({
  slug: z.string(),
  sessionId: z.string(),
  name: z.string(),
  purpose: z.string(),
  dir: z.string(),
  status: z.enum(['running', 'stopped']),
  createdAt: z.string(),
  lastActiveAt: z.string(),
});
export type Stream = z.infer<typeof StreamSchema>;

export const RegistrySchema = z.object({ streams: z.array(StreamSchema) });
export type Registry = z.infer<typeof RegistrySchema>;

export function loadRegistry(file: string): Registry {
  if (!fs.existsSync(file)) return { streams: [] };
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return RegistrySchema.parse(JSON.parse(raw));
  } catch {
    fs.writeFileSync(file + '.bak', raw);
    return { streams: [] };
  }
}

export function saveRegistry(file: string, reg: Registry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, file);
}

export function addStream(reg: Registry, s: Stream): Registry {
  if (reg.streams.some(x => x.slug === s.slug)) {
    throw new Error(`a stream with slug "${s.slug}" already exists`);
  }
  return { streams: [...reg.streams, s] };
}

export function getStream(reg: Registry, slug: string): Stream | undefined {
  return reg.streams.find(s => s.slug === slug);
}

export function updateStream(reg: Registry, slug: string, patch: Partial<Stream>): Registry {
  return { streams: reg.streams.map(s => (s.slug === slug ? { ...s, ...patch } : s)) };
}

export function removeStream(reg: Registry, slug: string): Registry {
  return { streams: reg.streams.filter(s => s.slug !== slug) };
}

export function sortStreams(streams: Stream[]): Stream[] {
  const rank = (s: Stream) => (s.status === 'running' ? 0 : 1);
  return [...streams].sort(
    (a, b) => rank(a) - rank(b) || b.lastActiveAt.localeCompare(a.lastActiveAt),
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: registry schema, atomic IO, CRUD, sort"
```

---

### Task 3: `shell` quoting + `claude` invocation builders

**Files:**
- Create: `src/shell.ts`, `src/shell.test.ts`, `src/claude.ts`, `src/claude.test.ts`

**Interfaces:**
- Produces:
  - `shellJoin(argv: string[]): string`
  - `buildNewInvocation(opts: { sessionId: string; name: string }): string[]`
  - `buildReviveInvocation(opts: { sessionId: string }): string[]`

- [ ] **Step 1: Write the failing test — `src/shell.test.ts`**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/shell.test.ts`
Expected: FAIL — cannot resolve `./shell.js`.

- [ ] **Step 3: Implement `src/shell.ts`**

```ts
export function shellJoin(argv: string[]): string {
  return argv.map(quote).join(' ');
}

function quote(token: string): string {
  if (/^[a-zA-Z0-9_\-./:=@]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test — `src/claude.test.ts`**

```ts
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/claude.test.ts`
Expected: FAIL — cannot resolve `./claude.js`.

- [ ] **Step 7: Implement `src/claude.ts`**

```ts
export function buildNewInvocation(opts: { sessionId: string; name: string }): string[] {
  return ['claude', '--session-id', opts.sessionId, '--remote-control', '--name', opts.name];
}

export function buildReviveInvocation(opts: { sessionId: string }): string[] {
  return ['claude', '--remote-control', '--resume', opts.sessionId];
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test src/shell.test.ts src/claude.test.ts`
Expected: PASS.

> **Note:** Task 12 verifies these exact flag combinations against the real `claude` binary. If `--session-id` + `--remote-control` cannot co-exist, only these two tiny builders change.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: shell quoting + claude invocation builders"
```

---

### Task 4: `tmux` driver

**Files:**
- Create: `src/tmux.ts`, `src/tmux.test.ts`

**Interfaces:**
- Consumes: `shellJoin` (Task 3).
- Produces:
  - `type Runner = { capture(cmd: string, args: string[]): { status: number; stdout: string }; interactive(cmd: string, args: string[]): number }`
  - `defaultRunner: Runner`
  - `const SESSION = 'cx'`
  - `ensureSession(r: Runner): void`
  - `windowExists(r: Runner, slug: string): boolean`
  - `paneCommand(r: Runner, slug: string): string | null`
  - `newWindow(r: Runner, opts: { slug: string; dir: string; command: string }): void`
  - `killWindow(r: Runner, slug: string): void`
  - `attachWindow(r: Runner, slug: string): void`

- [ ] **Step 1: Write the failing test — `src/tmux.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  ensureSession, windowExists, paneCommand, newWindow, killWindow, type Runner,
} from './tmux.js';

function fakeRunner(): Runner & { calls: string[][] } {
  const windows = new Set<string>();
  const calls: string[][] = [];
  return {
    calls,
    capture(cmd, args) {
      calls.push([cmd, ...args]);
      if (args[0] === 'has-session') return { status: 0, stdout: '' };
      if (args[0] === 'list-windows') {
        return { status: 0, stdout: [...windows].join('\n') };
      }
      if (args[0] === 'display-message') return { status: 0, stdout: 'node' };
      if (args[0] === 'new-window') { windows.add(args[args.indexOf('-n') + 1]); return { status: 0, stdout: '' }; }
      if (args[0] === 'kill-window') { windows.delete(args[args.indexOf('-t') + 1].split(':')[1]); return { status: 0, stdout: '' }; }
      return { status: 0, stdout: '' };
    },
    interactive(cmd, args) { calls.push([cmd, ...args]); return 0; },
  };
}

describe('tmux driver', () => {
  it('creates a window in the cx session and reports it exists', () => {
    const r = fakeRunner();
    ensureSession(r);
    expect(windowExists(r, 'infra')).toBe(false);
    newWindow(r, { slug: 'infra', dir: '/tmp/x', command: 'claude --resume id' });
    expect(windowExists(r, 'infra')).toBe(true);
  });

  it('reads the pane command and kills the window', () => {
    const r = fakeRunner();
    newWindow(r, { slug: 'infra', dir: '/tmp/x', command: 'claude' });
    expect(paneCommand(r, 'infra')).toBe('node');
    killWindow(r, 'infra');
    expect(windowExists(r, 'infra')).toBe(false);
  });

  it('passes the command and start dir to new-window', () => {
    const r = fakeRunner();
    newWindow(r, { slug: 'infra', dir: '/tmp/x', command: 'claude --remote-control' });
    const call = r.calls.find(c => c[1] === 'new-window')!;
    expect(call).toContain('/tmp/x');
    expect(call).toContain('claude --remote-control');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tmux.test.ts`
Expected: FAIL — cannot resolve `./tmux.js`.

- [ ] **Step 3: Implement `src/tmux.ts`**

```ts
import { spawnSync } from 'node:child_process';

export const SESSION = 'cx';
const SHELLS = new Set(['zsh', 'bash', 'sh', '-zsh', '-bash', 'fish', 'tmux']);

export type Runner = {
  capture(cmd: string, args: string[]): { status: number; stdout: string };
  interactive(cmd: string, args: string[]): number;
};

export const defaultRunner: Runner = {
  capture(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    return { status: r.status ?? 1, stdout: r.stdout ?? '' };
  },
  interactive(cmd, args) {
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    return r.status ?? 1;
  },
};

const target = (slug: string) => `${SESSION}:${slug}`;

export function ensureSession(r: Runner): void {
  if (r.capture('tmux', ['has-session', '-t', SESSION]).status !== 0) {
    r.capture('tmux', ['new-session', '-d', '-s', SESSION, '-n', '__home']);
  }
}

export function windowExists(r: Runner, slug: string): boolean {
  const out = r.capture('tmux', ['list-windows', '-t', SESSION, '-F', '#{window_name}']);
  if (out.status !== 0) return false;
  return out.stdout.split('\n').map(s => s.trim()).includes(slug);
}

export function paneCommand(r: Runner, slug: string): string | null {
  const out = r.capture('tmux', ['display-message', '-p', '-t', target(slug), '#{pane_current_command}']);
  if (out.status !== 0) return null;
  const cmd = out.stdout.trim();
  return cmd === '' ? null : cmd;
}

export function newWindow(r: Runner, opts: { slug: string; dir: string; command: string }): void {
  ensureSession(r);
  r.capture('tmux', [
    'new-window', '-t', SESSION, '-n', opts.slug, '-c', opts.dir, opts.command,
  ]);
}

export function killWindow(r: Runner, slug: string): void {
  r.capture('tmux', ['kill-window', '-t', target(slug)]);
}

export function attachWindow(r: Runner, slug: string): void {
  r.capture('tmux', ['select-window', '-t', target(slug)]);
  if (process.env.TMUX) {
    r.interactive('tmux', ['switch-client', '-t', target(slug)]);
  } else {
    r.interactive('tmux', ['attach-session', '-t', target(slug)]);
  }
}

export { SHELLS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/tmux.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: tmux driver over an injectable runner"
```

---

### Task 5: `liveness` reconciler

**Files:**
- Create: `src/liveness.ts`, `src/liveness.test.ts`

**Interfaces:**
- Consumes: `Runner`, `windowExists`, `paneCommand`, `SHELLS` (Task 4); `Registry`, `Stream`, `updateStream` (Task 2).
- Produces:
  - `isLive(r: Runner, stream: Stream): boolean`
  - `reconcile(reg: Registry, r: Runner): Registry`

- [ ] **Step 1: Write the failing test — `src/liveness.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isLive, reconcile } from './liveness.js';
import { StreamSchema, type Stream, type Registry } from './registry.js';
import { type Runner } from './tmux.js';

const stream = (over: Partial<Stream> = {}): Stream => StreamSchema.parse({
  slug: 'infra', sessionId: 'id', name: 'Infra', purpose: 'p', dir: '/tmp',
  status: 'running', createdAt: 'x', lastActiveAt: 'x', ...over,
});

function runnerWith(state: { exists: boolean; pane: string }): Runner {
  return {
    capture(_cmd, args) {
      if (args[0] === 'list-windows') return { status: 0, stdout: state.exists ? 'infra' : '' };
      if (args[0] === 'display-message') return { status: 0, stdout: state.pane };
      return { status: 0, stdout: '' };
    },
    interactive() { return 0; },
  };
}

describe('liveness', () => {
  it('is live when the window exists and the pane runs a non-shell command', () => {
    expect(isLive(runnerWith({ exists: true, pane: 'node' }), stream())).toBe(true);
  });
  it('is not live when the pane is just a shell', () => {
    expect(isLive(runnerWith({ exists: true, pane: 'zsh' }), stream())).toBe(false);
  });
  it('is not live when the window is gone', () => {
    expect(isLive(runnerWith({ exists: false, pane: '' }), stream())).toBe(false);
  });
  it('reconcile downgrades a dead "running" stream to stopped', () => {
    const reg: Registry = { streams: [stream({ status: 'running' })] };
    const out = reconcile(reg, runnerWith({ exists: false, pane: '' }));
    expect(out.streams[0].status).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/liveness.test.ts`
Expected: FAIL — cannot resolve `./liveness.js`.

- [ ] **Step 3: Implement `src/liveness.ts`**

```ts
import { windowExists, paneCommand, SHELLS, type Runner } from './tmux.js';
import { updateStream, type Registry, type Stream } from './registry.js';

export function isLive(r: Runner, stream: Stream): boolean {
  if (!windowExists(r, stream.slug)) return false;
  const cmd = paneCommand(r, stream.slug);
  return cmd !== null && !SHELLS.has(cmd);
}

export function reconcile(reg: Registry, r: Runner): Registry {
  let next = reg;
  for (const s of reg.streams) {
    const status = isLive(r, s) ? 'running' : 'stopped';
    if (status !== s.status) next = updateStream(next, s.slug, { status });
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/liveness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: liveness reconciler from tmux ground truth"
```

---

### Task 6: `cmdNew` + `cmdLs` (+ table render)

**Files:**
- Create: `src/render.ts`, `src/render.test.ts`, `src/commands.ts`, `src/commands.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces:
  - `type Deps = { regPath: string; runner: Runner }`
  - `cmdNew(args: { purpose: string; dir: string; slug?: string; name?: string }, deps: Deps): Stream`
  - `cmdLs(deps: Deps): string`
  - `renderTable(streams: Stream[]): string`

- [ ] **Step 1: Write the failing test — `src/render.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { renderTable } from './render.js';
import { StreamSchema, type Stream } from './registry.js';

const s = (over: Partial<Stream>): Stream => StreamSchema.parse({
  slug: 'infra', sessionId: 'id', name: 'Infra', purpose: 'render env',
  dir: '/tmp', status: 'running', createdAt: 'x', lastActiveAt: 'x', ...over,
});

describe('renderTable', () => {
  it('shows a filled dot for running and hollow for stopped, with slug + purpose', () => {
    const out = renderTable([s({ status: 'running', slug: 'a', purpose: 'live one' }),
                             s({ status: 'stopped', slug: 'b', purpose: 'idle one' })]);
    expect(out).toMatch(/●\s+a\b.*live one/);
    expect(out).toMatch(/○\s+b\b.*idle one/);
  });
  it('renders an empty-state line when there are no streams', () => {
    expect(renderTable([])).toMatch(/no streams/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/render.test.ts`
Expected: FAIL — cannot resolve `./render.js`.

- [ ] **Step 3: Implement `src/render.ts`**

```ts
import { type Stream } from './registry.js';

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s.padEnd(n));

export function renderTable(streams: Stream[]): string {
  if (streams.length === 0) return 'no streams yet — `cx new "<purpose>"` to start one';
  return streams
    .map(s => {
      const dot = s.status === 'running' ? '●' : '○';
      return `${dot} ${pad(s.slug, 14)} ${pad(s.name, 20)} ${s.purpose}`;
    })
    .join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test — `src/commands.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { cmdNew, cmdLs, type Deps } from './commands.js';
import { loadRegistry } from './registry.js';
import { type Runner } from './tmux.js';

let regPath: string;
let newWindowCalls: { slug: string; dir: string; command: string }[];

function recordingRunner(): Runner {
  return {
    capture(_cmd, args) {
      if (args[0] === 'new-window') {
        const slug = args[args.indexOf('-n') + 1];
        const dir = args[args.indexOf('-c') + 1];
        const command = args[args.length - 1];
        newWindowCalls.push({ slug, dir, command });
      }
      if (args[0] === 'list-windows') {
        return { status: 0, stdout: newWindowCalls.map(c => c.slug).join('\n') };
      }
      if (args[0] === 'display-message') return { status: 0, stdout: 'node' };
      return { status: 0, stdout: '' };
    },
    interactive() { return 0; },
  };
}

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  regPath = path.join(dir, 'registry.json');
  newWindowCalls = [];
  deps = { regPath, runner: recordingRunner() };
});

describe('cmdNew', () => {
  it('registers a running stream and opens a tmux window with the new invocation', () => {
    const s = cmdNew({ purpose: 'refresh triggers', dir: '/tmp/proj' }, deps);
    expect(s.status).toBe('running');
    expect(s.purpose).toBe('refresh triggers');
    expect(s.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(loadRegistry(regPath).streams).toHaveLength(1);

    const call = newWindowCalls[0];
    expect(call.dir).toBe('/tmp/proj');
    expect(call.command).toContain('--session-id');
    expect(call.command).toContain(s.sessionId);
    expect(call.command).toContain('--remote-control');
  });

  it('derives a unique slug from the name/purpose', () => {
    cmdNew({ purpose: 'infra cleanup', dir: '/tmp', slug: 'infra' }, deps);
    const s2 = cmdNew({ purpose: 'infra again', dir: '/tmp', slug: 'infra' }, deps);
    expect(s2.slug).toBe('infra-2');
  });
});

describe('cmdLs', () => {
  it('lists registered streams and reconciles liveness', () => {
    cmdNew({ purpose: 'one', dir: '/tmp' }, deps);
    const out = cmdLs(deps);
    expect(out).toMatch(/one/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/commands.test.ts`
Expected: FAIL — cannot resolve `./commands.js`.

- [ ] **Step 7: Implement `src/commands.ts` (cmdNew + cmdLs)**

```ts
import { randomUUID } from 'node:crypto';
import {
  loadRegistry, saveRegistry, addStream, sortStreams, type Stream,
} from './registry.js';
import { slugify, uniqueSlug } from './slug.js';
import { shellJoin } from './shell.js';
import { buildNewInvocation } from './claude.js';
import { newWindow, attachWindow, type Runner } from './tmux.js';
import { reconcile } from './liveness.js';
import { renderTable } from './render.js';

export type Deps = { regPath: string; runner: Runner };

const nowIso = () => new Date().toISOString();

export function cmdNew(
  args: { purpose: string; dir: string; slug?: string; name?: string },
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

  const command = shellJoin(buildNewInvocation({ sessionId, name }));
  newWindow(deps.runner, { slug, dir: args.dir, command });
  saveRegistry(deps.regPath, addStream(reg, stream));
  attachWindow(deps.runner, slug);
  return stream;
}

export function cmdLs(deps: Deps): string {
  const reg = reconcile(loadRegistry(deps.regPath), deps.runner);
  saveRegistry(deps.regPath, reg);
  return renderTable(sortStreams(reg.streams));
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test src/render.test.ts src/commands.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: cmdNew + cmdLs with table render"
```

---

### Task 7: `cmdGo` + `cmdDone`

**Files:**
- Modify: `src/commands.ts`, `src/commands.test.ts`

**Interfaces:**
- Produces:
  - `cmdGo(args: { slug: string }, deps: Deps): void` (throws if slug unknown)
  - `cmdDone(args: { slug: string }, deps: Deps): void` (throws if slug unknown)

- [ ] **Step 1: Add failing tests to `src/commands.test.ts`**

```ts
import { cmdGo, cmdDone } from './commands.js';
import { getStream } from './registry.js';

describe('cmdGo', () => {
  it('revives a stopped stream with a resume invocation and marks it running', () => {
    const s = cmdNew({ purpose: 'revive me', dir: '/tmp', slug: 'rev' }, deps);
    cmdDone({ slug: 'rev' }, deps);
    expect(getStream(loadRegistry(regPath), 'rev')?.status).toBe('stopped');

    newWindowCalls = [];
    cmdGo({ slug: 'rev' }, deps);
    const call = newWindowCalls.at(-1)!;
    expect(call.command).toContain('--resume');
    expect(call.command).toContain(s.sessionId);
    expect(getStream(loadRegistry(regPath), 'rev')?.status).toBe('running');
  });

  it('throws on an unknown slug', () => {
    expect(() => cmdGo({ slug: 'nope' }, deps)).toThrow(/nope/);
  });
});

describe('cmdDone', () => {
  it('keeps the registry entry but marks it stopped', () => {
    cmdNew({ purpose: 'keep me', dir: '/tmp', slug: 'keep' }, deps);
    cmdDone({ slug: 'keep' }, deps);
    const s = getStream(loadRegistry(regPath), 'keep');
    expect(s).toBeDefined();
    expect(s?.status).toBe('stopped');
  });
});
```

> **Note on the `cmdGo` revive test:** the fake runner reports a window as existing once `new-window` has been recorded, and `kill-window` is not modeled, so after `cmdDone` the test clears `newWindowCalls` to force `isLive` false (no recorded windows ⇒ `list-windows` empty), exercising the revive branch. Keep the `newWindowCalls = []` line.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/commands.test.ts`
Expected: FAIL — `cmdGo`/`cmdDone` not exported.

- [ ] **Step 3: Append to `src/commands.ts`**

```ts
import { getStream, updateStream } from './registry.js';
import { buildReviveInvocation } from './claude.js';
import { killWindow } from './tmux.js';
import { isLive } from './liveness.js';

export function cmdGo(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);

  if (!isLive(deps.runner, stream)) {
    const command = shellJoin(buildReviveInvocation({ sessionId: stream.sessionId }));
    newWindow(deps.runner, { slug: stream.slug, dir: stream.dir, command });
    saveRegistry(deps.regPath, updateStream(reg, stream.slug, {
      status: 'running', lastActiveAt: nowIso(),
    }));
  }
  attachWindow(deps.runner, args.slug);
}

export function cmdDone(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);
  killWindow(deps.runner, args.slug);
  saveRegistry(deps.regPath, updateStream(reg, args.slug, { status: 'stopped' }));
}
```

> Merge the new `import` lines into the existing import block from Task 6 rather than duplicating module specifiers (e.g. extend the `./registry.js` and `./tmux.js` imports). Do not leave two `import … from './registry.js'` lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cmdGo (attach/revive) + cmdDone (stop, keep)"
```

---

### Task 8: `cmdEdit` + `cmdRm`

**Files:**
- Modify: `src/commands.ts`, `src/commands.test.ts`

**Interfaces:**
- Produces:
  - `cmdEdit(args: { slug: string; purpose?: string; name?: string }, deps: Deps): Stream`
  - `cmdRm(args: { slug: string }, deps: Deps): void`

- [ ] **Step 1: Add failing tests to `src/commands.test.ts`**

```ts
import { cmdEdit, cmdRm } from './commands.js';

describe('cmdEdit', () => {
  it('updates purpose and name', () => {
    cmdNew({ purpose: 'old purpose', dir: '/tmp', slug: 'e' }, deps);
    const s = cmdEdit({ slug: 'e', purpose: 'new purpose', name: 'Renamed' }, deps);
    expect(s.purpose).toBe('new purpose');
    expect(s.name).toBe('Renamed');
    expect(getStream(loadRegistry(regPath), 'e')?.purpose).toBe('new purpose');
  });
});

describe('cmdRm', () => {
  it('removes the registry entry entirely', () => {
    cmdNew({ purpose: 'bye', dir: '/tmp', slug: 'r' }, deps);
    cmdRm({ slug: 'r' }, deps);
    expect(getStream(loadRegistry(regPath), 'r')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/commands.test.ts`
Expected: FAIL — `cmdEdit`/`cmdRm` not exported.

- [ ] **Step 3: Append to `src/commands.ts`**

```ts
import { removeStream } from './registry.js';

export function cmdEdit(
  args: { slug: string; purpose?: string; name?: string },
  deps: Deps,
): Stream {
  const reg = loadRegistry(deps.regPath);
  const stream = getStream(reg, args.slug);
  if (!stream) throw new Error(`no stream "${args.slug}"`);
  const patch: Partial<Stream> = {};
  if (args.purpose !== undefined) patch.purpose = args.purpose;
  if (args.name !== undefined) patch.name = args.name;
  const next = updateStream(reg, args.slug, patch);
  saveRegistry(deps.regPath, next);
  return getStream(next, args.slug)!;
}

export function cmdRm(args: { slug: string }, deps: Deps): void {
  const reg = loadRegistry(deps.regPath);
  if (!getStream(reg, args.slug)) throw new Error(`no stream "${args.slug}"`);
  killWindow(deps.runner, args.slug);
  saveRegistry(deps.regPath, removeStream(reg, args.slug));
}
```

> Fold the `removeStream` import into the existing `./registry.js` import line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cmdEdit + cmdRm"
```

---

### Task 9: CLI dispatcher (`bin/cx.ts`)

**Files:**
- Create: `bin/cx.ts`, `src/cli.ts`, `src/cli.test.ts`

**Interfaces:**
- Consumes: all `cmd*` functions, `registryPath`, `defaultRunner`.
- Produces: `runCli(argv: string[], deps: Deps): { output?: string; launchTui?: boolean }`

- [ ] **Step 1: Write the failing test — `src/cli.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from './cli.js';
import { type Deps } from './commands.js';
import { type Runner } from './tmux.js';

const noopRunner: Runner = {
  capture(_c, args) {
    if (args[0] === 'list-windows') return { status: 0, stdout: '' };
    return { status: 0, stdout: '' };
  },
  interactive() { return 0; },
};

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  deps = { regPath: path.join(dir, 'registry.json'), runner: noopRunner };
});

describe('runCli', () => {
  it('signals a TUI launch when given no args', () => {
    expect(runCli([], deps)).toEqual({ launchTui: true });
  });
  it('new then ls round-trips through the CLI surface', () => {
    runCli(['new', 'refresh triggers', '--slug', 'trg'], deps);
    const res = runCli(['ls'], deps);
    expect(res.output).toMatch(/trg/);
  });
  it('errors clearly on an unknown command', () => {
    expect(() => runCli(['frobnicate'], deps)).toThrow(/unknown command/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/cli.test.ts`
Expected: FAIL — cannot resolve `./cli.js`.

- [ ] **Step 3: Implement `src/cli.ts`**

```ts
import { parseArgs } from 'node:util';
import { cmdNew, cmdLs, cmdGo, cmdDone, cmdEdit, cmdRm, type Deps } from './commands.js';

export function runCli(argv: string[], deps: Deps): { output?: string; launchTui?: boolean } {
  const [cmd, ...rest] = argv;
  if (!cmd) return { launchTui: true };

  switch (cmd) {
    case 'new': {
      const { values, positionals } = parseArgs({
        args: rest, allowPositionals: true,
        options: { dir: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' } },
      });
      const purpose = positionals.join(' ').trim();
      if (!purpose) throw new Error('usage: cx new "<purpose>" [--dir .] [--slug x] [--name n]');
      const s = cmdNew({ purpose, dir: values.dir ?? process.cwd(), slug: values.slug, name: values.name }, deps);
      return { output: `started "${s.slug}" (${s.sessionId})` };
    }
    case 'ls':
      return { output: cmdLs(deps) };
    case 'go': {
      const slug = requireSlug(rest, 'go');
      cmdGo({ slug }, deps);
      return {};
    }
    case 'done': {
      const slug = requireSlug(rest, 'done');
      cmdDone({ slug }, deps);
      return { output: `stopped "${slug}" (kept)` };
    }
    case 'edit': {
      const { values, positionals } = parseArgs({
        args: rest, allowPositionals: true,
        options: { purpose: { type: 'string' }, name: { type: 'string' } },
      });
      const slug = positionals[0];
      if (!slug) throw new Error('usage: cx edit <slug> [--purpose ...] [--name ...]');
      const s = cmdEdit({ slug, purpose: values.purpose, name: values.name }, deps);
      return { output: `updated "${s.slug}"` };
    }
    case 'rm': {
      const slug = requireSlug(rest, 'rm');
      cmdRm({ slug }, deps);
      return { output: `removed "${slug}"` };
    }
    default:
      throw new Error(`unknown command: ${cmd}`);
  }
}

function requireSlug(rest: string[], verb: string): string {
  const slug = rest[0];
  if (!slug) throw new Error(`usage: cx ${verb} <slug>`);
  return slug;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `bin/cx.ts` (the executable entry)**

```ts
#!/usr/bin/env node
import { runCli } from '../src/cli.js';
import { registryPath } from '../src/paths.js';
import { defaultRunner } from '../src/tmux.js';
import { launchTui } from '../src/tui/launch.js';

try {
  const res = runCli(process.argv.slice(2), { regPath: registryPath(), runner: defaultRunner });
  if (res.launchTui) {
    await launchTui({ regPath: registryPath(), runner: defaultRunner });
  } else if (res.output) {
    console.log(res.output);
  }
} catch (err) {
  console.error(`cx: ${(err as Error).message}`);
  process.exit(1);
}
```

> `src/tui/launch.ts` does not exist yet — Task 11 creates it. Until then, `bin/cx.ts` will not compile. That is expected; the CLI logic is fully tested via `src/cli.test.ts`. Do not run `pnpm build` until Task 11.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: CLI dispatcher + bin entry"
```

---

### Task 10: TUI data hook (`useStreams`)

**Files:**
- Create: `src/tui/useStreams.ts`, `src/tui/useStreams.test.ts`

**Interfaces:**
- Consumes: `loadRegistry`, `reconcile`, `saveRegistry`, `sortStreams`, `Deps`.
- Produces:
  - `readStreams(deps: Deps): Stream[]` (load → reconcile → persist → sort)
  - `useStreams(deps: Deps, intervalMs?: number): Stream[]` (React hook polling `readStreams`)

- [ ] **Step 1: Write the failing test — `src/tui/useStreams.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { readStreams } from './useStreams.js';
import { cmdNew, type Deps } from '../commands.js';
import { type Runner } from '../tmux.js';

const runner: Runner = {
  capture(_c, args) {
    if (args[0] === 'list-windows') return { status: 0, stdout: '' }; // nothing live
    return { status: 0, stdout: '' };
  },
  interactive() { return 0; },
};

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  deps = { regPath: path.join(dir, 'registry.json'), runner };
});

describe('readStreams', () => {
  it('returns reconciled, sorted streams', () => {
    cmdNew({ purpose: 'one', dir: '/tmp', slug: 'one' }, deps);
    const streams = readStreams(deps);
    expect(streams).toHaveLength(1);
    expect(streams[0].status).toBe('stopped'); // reconciled: no live window
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tui/useStreams.test.ts`
Expected: FAIL — cannot resolve `./useStreams.js`.

- [ ] **Step 3: Implement `src/tui/useStreams.ts`**

```ts
import { useEffect, useState } from 'react';
import { loadRegistry, saveRegistry, sortStreams, type Stream } from '../registry.js';
import { reconcile } from '../liveness.js';
import { type Deps } from '../commands.js';

export function readStreams(deps: Deps): Stream[] {
  const reg = reconcile(loadRegistry(deps.regPath), deps.runner);
  saveRegistry(deps.regPath, reg);
  return sortStreams(reg.streams);
}

export function useStreams(deps: Deps, intervalMs = 1000): Stream[] {
  const [streams, setStreams] = useState<Stream[]>(() => readStreams(deps));
  useEffect(() => {
    const id = setInterval(() => setStreams(readStreams(deps)), intervalMs);
    return () => clearInterval(id);
  }, [deps, intervalMs]);
  return streams;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/tui/useStreams.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: TUI data hook (reconcile + poll)"
```

---

### Task 11: TUI component + launcher

**Files:**
- Create: `src/tui/App.tsx`, `src/tui/App.test.tsx`, `src/tui/launch.ts`

**Interfaces:**
- Consumes: `useStreams`, `readStreams`, `cmdGo`, `cmdDone`, `cmdNew`, `cmdRm`, `Deps`.
- Produces:
  - `App(props: { deps: Deps; onAttach: (slug: string) => void; onCreate: (purpose: string) => void; onExit: () => void }): JSX.Element`
  - `launchTui(deps: Deps): Promise<void>`

> **Why `onCreate` is deferred:** attaching to (or creating, which then attaches)
> a tmux window hands the TTY to `tmux attach-session`. Doing that *while ink
> still owns raw-mode stdin/stdout* corrupts both. So the TUI only **signals**
> intent (`onAttach`/`onCreate`); `launchTui` performs the terminal-handoff
> spawn after ink has unmounted. `done`/`remove` don't hand off the terminal
> (they only run captured tmux/registry ops), so they stay inline.

- [ ] **Step 1: Write the failing smoke test — `src/tui/App.test.tsx`**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { cmdNew, type Deps } from '../commands.js';
import { type Runner } from '../tmux.js';

const runner: Runner = {
  capture(_c, args) {
    if (args[0] === 'list-windows') return { status: 0, stdout: '' };
    return { status: 0, stdout: '' };
  },
  interactive() { return 0; },
};

let deps: Deps;
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-'));
  deps = { regPath: path.join(dir, 'registry.json'), runner };
});

describe('App', () => {
  it('lists existing streams by name', () => {
    cmdNew({ purpose: 'refresh triggers', dir: '/tmp', slug: 'trg', name: 'Triggers' }, deps);
    const { lastFrame } = render(
      <App deps={deps} onAttach={() => {}} onCreate={() => {}} onExit={() => {}} />,
    );
    expect(lastFrame()).toMatch(/Triggers/);
  });

  it('shows the keybinding hint line', () => {
    const { lastFrame } = render(
      <App deps={deps} onAttach={() => {}} onCreate={() => {}} onExit={() => {}} />,
    );
    expect(lastFrame()).toMatch(/attach/);
    expect(lastFrame()).toMatch(/done/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tui/App.test.tsx`
Expected: FAIL — cannot resolve `./App.js`.

- [ ] **Step 3: Implement `src/tui/App.tsx`**

```tsx
import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { useStreams } from './useStreams.js';
import { cmdDone, cmdRm, type Deps } from '../commands.js';

type Props = {
  deps: Deps;
  onAttach: (slug: string) => void;
  onCreate: (purpose: string) => void;
  onExit: () => void;
};

export function App({ deps, onAttach, onCreate, onExit }: Props): JSX.Element {
  const streams = useStreams(deps);
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  const clamp = (i: number) => Math.max(0, Math.min(streams.length - 1, i));
  const current = streams[clamp(cursor)];

  useInput((input, key) => {
    if (creating) return;
    if (input === 'q') { onExit(); exit(); return; }
    if (key.upArrow) setCursor(c => clamp(c - 1));
    if (key.downArrow) setCursor(c => clamp(c + 1));
    if (key.return && current) { onAttach(current.slug); exit(); return; }
    if (input === 'n') { setDraft(''); setCreating(true); }
    if (input === 'd' && current) cmdDone({ slug: current.slug }, deps);
    if (input === 'x' && current) cmdRm({ slug: current.slug }, deps);
  });

  if (creating) {
    return (
      <Box flexDirection="column">
        <Text>new stream purpose:</Text>
        <TextInput
          value={draft}
          onChange={setDraft}
          onSubmit={(value) => {
            const purpose = value.trim();
            setCreating(false);
            if (purpose) { onCreate(purpose); exit(); }
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {streams.length === 0 && <Text dimColor>no streams yet — press n to start one</Text>}
      {streams.map((s, i) => (
        <Text key={s.slug} inverse={i === clamp(cursor)}>
          {s.status === 'running' ? '●' : '○'} {s.slug.padEnd(14)} {s.name.padEnd(20)} {s.purpose}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑↓ move  ⏎ attach  n new  d done  x remove  q quit</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/tui/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Implement `src/tui/launch.ts`** (exit ink, then hand the terminal to tmux)

```ts
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { cmdGo, cmdNew, type Deps } from '../commands.js';

export async function launchTui(deps: Deps): Promise<void> {
  let pendingAttach: string | null = null;
  let pendingCreate: string | null = null;
  const app = render(
    React.createElement(App, {
      deps,
      onAttach: (slug: string) => { pendingAttach = slug; },
      onCreate: (purpose: string) => { pendingCreate = purpose; },
      onExit: () => {},
    }),
  );
  await app.waitUntilExit();
  if (pendingCreate) cmdNew({ purpose: pendingCreate, dir: process.cwd() }, deps);
  else if (pendingAttach) cmdGo({ slug: pendingAttach }, deps);
}
```

- [ ] **Step 6: Build the whole project**

Run: `pnpm build`
Expected: `tsc` completes with no errors; `dist/bin/cx.js` exists.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: ALL tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: ink TUI + launcher with attach-on-exit"
```

---

### Task 12: Packaging, install, and real-path verification

**Files:**
- Create: `README.md`
- Modify: `src/claude.ts` (only if the real `claude` rejects the flag combination)

**Interfaces:** none new.

- [ ] **Step 1: Link the binary onto PATH**

Run: `pnpm build && pnpm link --global`
Expected: `which cx` resolves; `cx ls` prints the empty-state line.

- [ ] **Step 2: Verify the flag combination against the REAL claude binary**

Run (in a throwaway dir):
```bash
TEST_ID=$(uuidgen | tr 'A-Z' 'a-z')
claude --session-id "$TEST_ID" --remote-control --name "cx-flag-test" --help >/dev/null 2>&1; echo "new-combo exit: $?"
claude --remote-control --resume "$TEST_ID" --help >/dev/null 2>&1; echo "revive-combo exit: $?"
```
Expected: both exit `0` (flags accepted). `--help` short-circuits before launching, so this checks flag parsing without opening a session.
If either is non-zero: the flags don't co-exist. Apply the fallback — change `buildNewInvocation`/`buildReviveInvocation` and `cmdNew`/`cmdGo` so the window runs `claude --session-id <id> --resume <id>` and then issues `/remote-control` via a follow-up `tmux send-keys -t cx:<slug> '/remote-control' Enter`. Re-run the Task 3 tests with the updated expectations.

- [ ] **Step 3: Real end-to-end smoke (manual, the actual product)**

```bash
cx new "cx smoke test" --slug smoke --dir "$PWD"
```
Verify, in order:
1. A tmux session `cx` exists with a window named `smoke` (`tmux list-windows -t cx`).
2. That window is running an interactive `claude` (you land in it), showing the remote-control URL/QR.
3. The session appears at `claude.ai/code` named **cx smoke test** with a green dot.
4. `cx ls` shows `● smoke`.
5. `cx done smoke` → the window closes, `cx ls` shows `○ smoke`.
6. `cx go smoke` → re-opens, the prior conversation is intact (resumed by id), remote control is live again.
7. `cx rm smoke` → gone from `cx ls`; clean up the tmux window if any.

Record the result of each numbered check. If any fails, stop and fix before proceeding.

- [ ] **Step 4: Write `README.md`**

```markdown
# cx

A control plane for many Claude Code sessions. One registry, a CLI, and a live TUI.

## Install
    pnpm install && pnpm build && pnpm link --global

## Use
    cx                       # live TUI: see what's running, ⏎ to jump in
    cx new "<purpose>"       # start a named, remote-controlled session in tmux
    cx ls                    # list streams (running first)
    cx go <slug>             # attach; revives a stopped one (context intact)
    cx done <slug>           # stop but keep — fearless close
    cx edit <slug> --purpose "..."   # update the memory line
    cx rm <slug>             # delete from the registry

Sessions live in one tmux session named `cx`. The registry is at `~/.cx/registry.json`
(override with `CX_HOME`). Every session is interactive `claude --remote-control` — never `-p`.
```

- [ ] **Step 5: Final full gate**

Run: `pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: README; verify real-path flags + e2e"
```

---

## Self-Review

**Spec coverage** — every DESIGN.md section maps to a task:
- Registry (durable, atomic, validated, `~/.cx`, `CX_HOME`) → Task 2.
- Stream model incl. `sessionId` join key → Task 2.
- Interactive `--remote-control`, never `-p`; `--session-id`/`--resume <id>` → Tasks 3, 12.
- tmux driver, one `cx` session, quarantine → Task 4.
- Liveness from ground truth → Task 5.
- CLI verbs (`new/ls/go/done/edit/rm`) → Tasks 6–9.
- `cx` no-args → TUI → Tasks 9, 11.
- Live TUI (see-what's-live, attach) → Tasks 10–11.
- Error handling (corruption backup, missing session, stale entries, slug collisions) → Tasks 2, 4, 5, 7. **Known gap:** the spec's "warn on vanished `dir`" is *not* implemented — `cmdGo`/`cmdNew` let tmux surface the error instead. Add an explicit `fs.existsSync(dir)` guard if that proves annoying in use.
- "To verify" flag composition → Task 12.
- Out-of-scope (phone, metering, multi-machine) → intentionally absent.

**Placeholder scan** — no TBD/TODO; every code step shows complete code; the one deliberately-deferred item (flag composition) is an explicit verify-with-fallback in Task 12, not a gap.

**Type consistency** — `Deps`, `Runner`, `Stream`, and all `cmd*`/`build*` signatures are declared once (Tasks 2–6) and reused unchanged downstream. `attachWindow`, `newWindow`, `killWindow`, `windowExists`, `paneCommand` names are stable across Tasks 4–11.
