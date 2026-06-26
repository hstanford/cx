# cx — a control plane for many Claude Code sessions

*Design doc — 2026-06-25*

## Mission

One laptop-side tool to manage the many concurrent Claude Code sessions I run.
It makes three things true that aren't today: every session is launched already
remote-controlled and named, I can see at a glance what's live and jump straight
in, and closing a session is fearless because nothing is lost.

## The problem it solves

Today, working across a laptop (everything runs locally in tmux) and the Claude
app on phone/laptop:

- Open Claude Code instances pile up and clutter tmux.
- I have to connect remote control from *inside* each session every time.
- I can't remember what a session was for from its name.
- I run single chats to the 1M-token limit because I don't want to context-switch.
- I hate closing chats in case there's a relevant follow-up.

## Principles & constraints

These are load-bearing — they shaped every decision below.

1. **Interactive only, never `-p`.** Sessions launch as interactive
   `claude --remote-control "<name>"` inside tmux. Headless `-p` is avoided
   entirely because of unresolved ambiguity over whether it bills at API rates
   vs. subscription. Billing must stay identical to working in the terminal today.
2. **The registry is the durable source of truth**, and it survives a session
   close. This is what makes closing fearless.
3. **Liveness is derived from local ground truth**, never trusted from a stored
   flag — there is *no* Claude API to query whether a remote-control session is
   alive (confirmed via research). The only truth is local: does the tmux window
   exist and is `claude` still running in it.
4. **Annotate Claude's native sessions; don't duplicate them.** Claude already
   stores sessions as JSONL keyed by a session UUID. On creation we pin that UUID
   with `--session-id`, store it, and revive with `--resume <id>`. The registry
   is a thin index *on top* that adds purpose, status, and tmux location, joined
   to Claude by **session id** — so display names stay free-form and need not be
   unique.
5. **One registry, multiple front-ends.** A CLI and a TUI ship in v1; the MCP
   dispatch daemon (`cx listen`) is a third front-end over the *same* registry,
   letting any existing Claude thread drive cx over MCP.
6. **Quarantine the clutter.** All session windows live in one dedicated tmux
   session, not scattered across my working tmux.

## What was ruled out (and why)

- **Auto-pinning live sessions to the top of the Claude app** — there is no
  external control surface for the app's remote-control session list (no flag,
  API, file, or ordering hook; pinning exists only for *background agents*, a
  different feature). The app sorts by last-active, so actively-worked sessions
  float up on their own. Phone discovery leans on clear naming instead.
- **Per-session token/context metering** — no programmatic read exists; deferred
  (could be parsed from JSONL later if it earns its keep).
- **Headless `-p` anywhere** — see principle 1.

## Architecture: one registry, three front-ends

```
                 ┌─────────────────────────────┐
   cx CLI  ─────▶│                             │
                 │   registry  ~/.cx/registry  │◀──── cx listen (MCP daemon)
   cx TUI  ─────▶│        .json                │
                 └──────────────┬──────────────┘
                                │ reconciled against
                 ┌──────────────▼──────────────┐
                 │  local ground truth:        │
                 │  tmux session `cx` + procs  │
                 └──────────────┬──────────────┘
                                │ drives
                 ┌──────────────▼──────────────┐
                 │  claude --remote-control     │
                 │  "<name>"  (interactive)     │
                 └─────────────────────────────┘
```

**Components**

1. **Registry** — a JSON file at a stable path *outside* the code dir
   (`~/.cx/registry.json`), so every front-end shares it regardless of where its
   code lives. Read and written atomically (write temp + rename), validated on
   read.
2. **tmux driver** — creates/selects/kills windows in a dedicated tmux session
   named `cx`; queries window existence and the pane's running command.
3. **claude launcher** — builds the interactive invocation in the stream's dir:
   for new, generate a UUID and run
   `claude --session-id <uuid> --remote-control --name "<name>"`; to revive a
   stopped stream, `claude --remote-control --resume <uuid>`.
4. **Liveness reconciler** — for each stream computes
   `live = tmux window exists AND its pane is running claude`, and reconciles
   that against the stored `status` so the displayed state is always honest.
5. **CLI front-end** — the verbs (below).
6. **TUI front-end** — a live dashboard over the same registry + reconciler.

## The model: a "stream"

A stream is one unit of work I care about.

| field         | meaning                                                            |
|---------------|--------------------------------------------------------------------|
| `slug`        | short unique handle for commands (`triggers`)                      |
| `sessionId`   | Claude session UUID — pinned via `--session-id` at creation; **the join key** for `--resume` |
| `name`        | descriptive; passed as Claude `--name` / remote-control title (free-form, need not be unique) |
| `purpose`     | one line — **the memory** of what this stream is for               |
| `dir`         | project working directory                                          |
| `status`      | `running` \| `stopped` (reconciled against ground truth on read)   |
| `createdAt`   | timestamp                                                          |
| `lastActiveAt`| timestamp, updated on `go`/`new`                                   |

The join into Claude is the `sessionId`, not the name — so names are free-form
and collisions are allowed. `slug` is the only field that must be unique (it's
the command handle) and defaults to a slugified `name`. `branch` is derived from
the dir's git state at display time, not stored.

## CLI verbs

```
cx                                  open the TUI (the home screen)
cx new "<purpose>" [--dir .]        register a stream, open a tmux window running
              [--slug x] [--name n] claude --remote-control "<name>", attach
cx ls [--all]                       list streams — running first, with status/dir/purpose
cx go <slug>                        attach; if stopped, revive with
                                    --remote-control --resume <id>, then attach
cx done <slug>                      stop: kill the window, mark stopped, KEEP the entry
cx edit <slug> [--purpose ...] [--name ...]   update fields
cx rm <slug>                        delete from the registry (rare; confirms)
```

`--dir` defaults to the current directory. `cx` with no args is the TUI.

## The TUI (the home screen)

Its one job is your stated core problem: *see what's live, know what to jump
into.* A live, auto-refreshing list (running grouped above stopped):

```
┌─ cx ──────────────────────────────────────────────────────────┐
│ ● self-serve   feat/self-serve-launch   2h   legal pages + gate│
│ ● triggers     feat/triggers-refresh   40m   refresh triggers  │
│ ○ infra        main                      —   render env cleanup│
├────────────────────────────────────────────────────────────────┤
│ ↑↓ move  ⏎ attach  n new  d done  r rename  x remove  q quit    │
└────────────────────────────────────────────────────────────────┘
```

Keys map to the same registry operations the CLI verbs use — the TUI is a second
front-end, not a separate implementation. Liveness dots come from the reconciler,
so a session that died outside `cx` shows as stopped rather than a stale green.

## Data flow

- **new** → write registry entry → create tmux window → launch claude → status `running` → attach.
- **ls / TUI** → read registry → reconcile liveness → render.
- **go** → if live, select the window; if stopped, re-launch with `--resume <id>`, then select.
- **done** → kill the window → status `stopped` → entry retained.

## Error handling

- **Registry corruption** — validated on read; atomic writes; a bad file is
  backed up rather than overwritten.
- **tmux session/window missing** — created on demand; never a hard failure.
- **Stale entries** (window died outside `cx`) — reconciler downgrades to
  `stopped` on next read.
- **Name/slug collision** — rejected at `new`/`edit`.
- **Vanished `dir`** — `go` warns instead of launching into nothing.

## How it maps back to the five pains

| pain                         | resolution                                                |
|------------------------------|-----------------------------------------------------------|
| tmux clutter                 | windows quarantined in one `cx` session; registry is truth |
| connect remote control each time | every `new`/`go` launches `--remote-control` automatically |
| can't remember the purpose   | `purpose` line in `ls`/TUI; names propagate to the app list |
| run to 1M tokens             | cheap, visible reattach + `/branch` make scoped sessions easy |
| hate closing                 | `done` keeps everything; `go` brings it fully back        |

## To verify during implementation

- That `--session-id <uuid>` can be pinned alongside `--remote-control --name` at
  creation, and that `--remote-control --resume <uuid>` compose in a single
  invocation (so reviving a stopped stream gets both context and remote control
  at once). Fallback if the compose fails: launch `--resume <uuid>` then issue
  `/remote-control` via tmux send-keys.

## Out of scope (named follow-ups)

- **MCP dispatch front-end (agent-initiated streams)** — *shipped (`cx listen`).*
  This is the agent-facing front-end: any existing Claude thread drives cx over
  MCP. It exposes a local MCP
  server (a third front-end over the same registry/command core) offering a
  `cx_spawn(purpose, dir?, seed?)` tool = `cmdNew` over MCP, returning the new
  stream's slug + remote-control URL. The point: let a *running* Claude Code
  session that notices it's straddling two topics offer — **with conversational
  consent** — to fork the tangent into its own **top-level** (peer, not
  subagent) remote-controlled stream, seeded with a handoff brief, so the
  original thread stays focused. This turns cx from passive session management
  into active focus-keeping, attacking the "run to 1M because I won't
  context-switch" pain at its source. Open questions: (1) seed-brief quality is
  the whole game; (2) consent is conversational (agent proposes → user confirms
  → tool fires), the judgment-to-offer lives in agent instructions/a skill, not
  the tool; (3) spawned sessions inherit the MCP server, so spawning is
  recursive — bounded by consent.

  **Shape: `cx listen` + the stateless-harness property.** The MCP server is a
  single idempotent daemon started by `cx listen` — one HTTP MCP endpoint many
  sessions point at (not per-session stdio), which is what makes "idempotent"
  meaningful and gives every session one shared spawn surface. Idempotency =
  bind-or-bail: claim the port/pidfile, exit 0 if the listener is already ours,
  so it's safe to run from a shell profile / launchd repeatedly and it
  self-heals. `cx listen` also manages the MCP *registration* so spawned
  sessions inherit the `cx` server (enabling the recursion above).

  This yields the architecture's nicest property: **the registry file is the
  only durable state; the verbs and TUI are stateless functions over it; tmux
  holds the sessions; and `cx listen` is the lone long-lived process — itself
  stateless beyond the registry, hence disposable/restartable.** No bespoke
  state-holding daemon of cx's own.

  **Discipline to preserve it:** keep `cx listen` thin. Do NOT make it a
  background watcher that reconciles liveness — that would make the daemon
  authoritative about state and reintroduce exactly the statefulness this
  design removes. Liveness stays lazy/on-read (as `ls`/TUI do today). The daemon
  only serves tools (calling the same stateless `cmd*` functions) and manages
  registration. The CLI/TUI never depend on `cx listen` — it is purely additive.
- Token/context metering per stream.
- Multi-machine registries.

## Implementation notes (non-binding)

- TypeScript/Node. TUI via `ink` is the likely choice but isn't load-bearing.
- Code lives at `~/src/cx`; the registry lives at `~/.cx/registry.json`.
