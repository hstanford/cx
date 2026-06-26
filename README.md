# cx

**Run a whole fleet of Claude Code sessions at once — and never lose one.**

cx is a control plane for the many Claude Code sessions you keep going in
parallel. Each is launched already remote-controlled and named, so you can see at
a glance what's live, jump straight into any of them, and close them without fear
— nothing is ever lost. Instead of a pile of look-alike terminal tabs, you get a
tidy list of named, resumable streams you can list, attach to, stop, and bring
back exactly where you left off.

## What it's great for

- **Running many tasks in parallel.** One session per task, branch, or repo —
  each in its own tmux window, addressable by a memorable name instead of a tab
  number. `cx ls` and the live TUI show you what's running at a glance.
- **Long investigations you don't want to lose.** Stop a session when you step
  away and `cx go` straight back into the full conversation later. Closing is
  fearless: the registry and Claude's own session file both survive it, so you
  resume exactly where you left off.
- **Staying out of one giant chat.** When a session notices it's straddling two
  topics, it can fork the tangent into its own peer session over MCP — with your
  consent (see [Agent dispatch](#agent-dispatch-cx-listen)). No more running a
  single chat to the token limit just to avoid context-switching.
- **Picking up from anywhere.** Sessions are remote-controlled, so you can carry
  on from the Claude app on your phone or laptop; clear names make them easy to
  find there.

## Requirements

- **[Claude Code](https://claude.com/claude-code)** CLI on your `PATH` and logged
  in. cx launches `claude --remote-control`, so you need a version that supports
  that flag.
- **tmux** — every session runs in a window of a dedicated `cx` tmux session,
  kept separate from your own tmux.
- **Node 18+** and **pnpm** — to build and link the CLI.

## Install

```
pnpm install && pnpm build && pnpm link --global
```

## Use

```
cx                       # live TUI: running streams shown in green ●, stopped in ○; ⏎ to jump in
cx new "<purpose>"       # start a named, remote-controlled session in tmux
cx ls                    # list streams (running first; hides archived)
cx ls --archived         # show only archived streams
cx ls --all              # show all streams including archived
cx go <slug>             # attach; revives a stopped one (context intact)
cx open <slug>           # open the session in your browser (claude.ai/code)
cx done <slug>           # stop but keep — fearless close
cx restart <slug>        # re-launch with current config (--all bounces every live one); history intact
cx archive <slug>        # hide (soft-delete) and stop it if live
cx restore <slug>        # un-hide and revive it — back up and running, context intact
                         # TUI: press `a` to switch to a dedicated Archived page (x restores, a/esc returns)
cx edit <slug> --purpose "..."   # update the memory line
cx rm <slug>             # hard delete from the registry (irreversible)
```

### TUI keys

`↑`/`↓` move · `⏎` attach · `n` new · `g` open in browser · `r` restart ·
`d` stop · `x` archive / restore · `a` toggle the archived page · `q` quit

## How it works

- All sessions live in one tmux session named `cx` (kept out of your working tmux).
- The registry is a JSON file at `~/.cx/registry.json` (override with `CX_HOME`).
  It is the only durable state — closing a session never touches it, so `cx go`
  brings the full conversation back by resuming the pinned session id.
- Archiving a stream hides it from default views and stops it if live, but nothing
  touches the Claude session file — `cx restore <slug>` un-hides and revives it
  (mirroring the stop on archive), back up and running with full context; `cx go`
  then attaches.
- Liveness is derived from local ground truth (the tmux window + its process),
  never a stored flag — so `cx ls`/the TUI always tell the truth.
- Every session is interactive `claude --remote-control` — **never** `-p`. Billing
  is identical to working in the terminal directly.

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

## Config

Create `~/.cx/config.json` to pass extra flags to every `claude` invocation cx spawns or revives:

```json
{ "claudeArgs": ["--permission-mode", "bypassPermissions"] }
```

- `claudeArgs` is a plain array of strings — cx passes them through unchanged, no interpretation.
- Flags are injected into every spawned and revived session.
- The file is read fresh each time cx spawns or revives a session.
- If the file is missing or malformed, cx silently proceeds with no extra flags.

### Restart

Config changes apply automatically to new sessions and to stopped sessions when next revived. To apply a config change to a session that is **currently running**, bounce it in the background:

```
cx restart <slug>     # re-launch one session with the current config
cx restart --all      # bounce all live sessions (stopped ones are left alone)
```

The session's conversation is intact — restart uses `--resume` with the pinned session id, so no history is lost. There is no terminal attach; the session continues running in the background. The `r` key in the TUI does the same for the selected stream.

> **Note:** if a turn is in progress when you restart, that turn is interrupted. Restart between turns for a clean transition.
