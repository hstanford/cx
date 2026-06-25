# cx

A control plane for many Claude Code sessions. One registry, a CLI, and a live TUI.

Every session is launched already remote-controlled and named, you can see at a
glance what's live and jump straight in, and closing a session is fearless —
nothing is lost.

## Install

```
pnpm install && pnpm build && pnpm link --global
```

## Use

```
cx                       # live TUI: see what's running, ⏎ to jump in
cx new "<purpose>"       # start a named, remote-controlled session in tmux
cx ls                    # list streams (running first)
cx go <slug>             # attach; revives a stopped one (context intact)
cx done <slug>           # stop but keep — fearless close
cx edit <slug> --purpose "..."   # update the memory line
cx rm <slug>             # delete from the registry
```

## How it works

- All sessions live in one tmux session named `cx` (kept out of your working tmux).
- The registry is a JSON file at `~/.cx/registry.json` (override with `CX_HOME`).
  It is the only durable state — closing a session never touches it, so `cx go`
  brings the full conversation back by resuming the pinned session id.
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

## Follow-ups

See `DESIGN.md` for a planned phone/Slack front-end over this same registry.
(The agent-initiated MCP dispatch server, `cx listen`, is built — see above.)
