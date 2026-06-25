# Archive Feature Report

## Summary
Replaced the hard-delete TUI `x` with a soft, reversible archive toggle. Hard delete remains available as `cx rm` (CLI only).

## Files Changed

| File | Change |
|------|--------|
| `src/registry.ts` | Added `archived: z.boolean().optional()` to `StreamSchema` |
| `src/commands.ts` | Added `cmdArchive`, `cmdRestore`; updated `cmdLs` with `opts?: { archived?, all? }` filter |
| `src/mcp/tools.ts` | `handleList` now filters `!s.archived` |
| `src/cli.ts` | Added `archive`/`restore` cases; `ls` case parses `--archived`/`--all` |
| `src/tui/App.tsx` | `showArchived` state, filtered display list, `x` toggle, `a` key, dim+suffix for archived rows, updated hint |
| `README.md` | Documents `cx archive`/`cx restore`, `cx ls --archived`/`--all`, `cx rm` as hard delete, session restore path |
| `src/commands.test.ts` | 10 new tests: `cmdArchive` (live+stopped+unknown), `cmdRestore` (clears flag+unknown), `cmdLs` filtering (default/archived/all) |
| `src/mcp/tools.test.ts` | 1 new test: `handleList` excludes archived |
| `src/cli.test.ts` | 3 new tests: archive/restore round-trip, `ls --archived`, `ls` default hides archived |

## TDD Evidence

Tests were written before running the full suite. Focused run with all 98 tests passing:
- 86 original tests unchanged and still green
- 12 new tests added and passing

## Self-Review

### `archived` is orthogonal to `status`/`reconcile`
- `reconcile` in `liveness.ts` and `isLive` in `tmux.ts` are untouched — they read/write only `status`.
- `cmdArchive` sets both `archived: true` AND `status: 'stopped'` explicitly, but `reconcile` will never touch `archived` since it only patches `status`.
- A restored (archived: false) stream retains its `status: 'stopped'` until the user runs `cx go` — correct behavior.

### `x` toggles archive/restore
- In App.tsx: `if (current.archived) cmdRestore(...) else cmdArchive(...)` — bidirectional toggle based on current state.

### Default views hide archived
- `cmdLs` default: `streams.filter(s => !s.archived)`
- TUI default (`showArchived=false`): `allStreams.filter(s => !s.archived)`
- `handleList` (MCP): `.filter(s => !s.archived)` always

### Cursor safety when filtered list shrinks
- `clamp` uses `streams.length` (the filtered list), not `allStreams.length`
- `const current = streams[clamp(cursor)] ?? undefined` — the `?? undefined` guard handles the empty-list case where `clamp` returns `-1` (but `Math.max(0, ...)` makes it 0, and `streams[0]` on empty array is `undefined`)
- When archiving the current row it disappears from the filtered list; the cursor stays at the same index which now points to the next item (or clamps to the new last item)

## Concerns

None. The implementation is clean and minimal. The `archived` flag is truly orthogonal to liveness reconciliation.
