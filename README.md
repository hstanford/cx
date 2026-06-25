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

## Follow-ups

See `DESIGN.md` for planned additions: a phone/Slack front-end and an
agent-initiated MCP dispatch server (`cx listen`) — both over this same registry.
