# Vyotiq Deep Audit — Reference

## Audit Checklist (every stream)

For each item, report: **finding → evidence → impact → recommended fix → effort (S/M/L)**.

### 1. Unwired & incomplete features

- IPC channels declared in `ipc.ts` but missing `handle`/`invoke` on one side
- Settings UI fields not persisted or not read by main process
- Tool definitions in `src/main/tools/` not in `AGENT_TOOLS` policy (or vice versa)
- UI components that render but never call real backends (stubs, `console.log`, empty handlers)
- Harness rules that reference tools or flows that no longer exist
- Features documented in `project.md` / `AGENTS.md` with no implementation, or implementation with no UI entry point

### 2. Inconsistencies

- **UI/UX:** spacing, selection tint, hover, typography, focus rings across dock / timeline / composer / settings / workbench
- **Styling:** hardcoded hex/`bg-[#…]` vs `@theme` tokens in `index.css`; one-off CSS vs `vx-*` / `SurfaceShell` / feature CSS (`dock-flyout.css`, etc.)
- **Naming & patterns:** duplicate helpers for the same concern (e.g. attachment errors in renderer vs shared)
- **Behavior:** keyboard shortcuts, escape stack, follow-up lanes (steering vs queued), workspace switch cleanup
- **Types:** drift between shared types, IPC payloads, and store shapes

### 3. Duplications & dead code

- Near-duplicate functions across `main/`, `renderer/`, `shared/` — consolidate into `shared/` when appropriate
- Unused files, exports, imports, CSS classes
- **Do not remove** features the user did not ask to remove; flag legacy code that is intentionally kept for transcript normalization
- **Do not revive** removed subsystems: phased execution, reflective autonomy, `plan` tool, tool re-run/permissions

### 4. Gaps

- Missing tests for critical paths (IPC round-trips, orchestrator messages, attachment ingest, bash timeout, etc.)
- Missing error surfaces in UI (silent failures in composer, dock, settings)
- Missing cleanup on workspace switch, chat switch, window close, provider change
- Missing `removeListener` / `AbortController` / `clearInterval` in long-lived renderer hooks

### 5. Bugs & errors

- Run `pnpm build` and targeted `pnpm vitest` per touched area; capture failures
- Type errors, race conditions, listener accumulation, orphaned `BrowserWindow` refs
- Broken flows: paste/drop attachments, capture ingest, scheduled runs, `ask_user` + follow-ups, terminal detach + agent `bash`

### 6. Improvements (non-blocking)

- Performance (unnecessary re-renders, unbounded polls)
- DX (module boundaries, file size > ~1k lines)
- Security (path traversal, sandbox escapes, secret logging)
- Only propose improvements with clear ROI; no speculative refactors

## Stream-Specific Probes

### A — IPC & wiring

- Cross-check `src/shared/types/ipc.ts` channel list vs main `handle` registrations and renderer `invoke` call sites
- Settings: UI field → store → IPC → main persistence round-trip
- Zustand store shapes vs shared types

### B — Agent runtime

- `src/main/tools/policy/` vs tool files under `src/main/tools/`
- Harness markdown references vs live tools and flows
- Follow-up lanes (steering vs queued), scheduler enqueue, `ask_user` settlement
- Orchestrator loop message handling and hidden tools (`finish`, `ask_user`)

### C — UI surfaces

- Shell Mono tokens in `src/renderer/index.css`; grep for hardcoded hex / `bg-[#`
- Dock selection tint (`dock-flyout.css`), composer attachments, timeline hidden tools
- Workbench tab cycle, escape stack, keybindings from settings

### D — Providers & context

- Model discovery via `GET /v1/models`; no hardcoded context windows or thinking flags
- `buildContextLayers.ts` layer topology; cache hints; vision token budget
- Billing block TTL (`recentBillingBlock.ts`); account/discovery pollers

### E — Lifecycle & leaks

- Main: `BrowserWindow` null on `closed`; quit handlers stop pollers/watchers/PTY
- Renderer: `useEffect` cleanup, `removeListener`, chat channel pattern
- Workspace switch: dispose LSP, watchers, PTY attach state

### F — Quality & dead code

- Grep: `TODO`, `FIXME`, `stub`, `console.log` in user paths
- `normalizeLegacyTranscript` boundaries — intentional legacy strip vs dead code
- Unused exports; duplicate helpers across main/renderer/shared
- Test coverage gaps for recent changes

## Priority Definitions

| Priority | Meaning | Examples |
|----------|---------|----------|
| **P0** | Broken, leak, or data loss | Listener accumulation, crash, corrupt persistence |
| **P1** | Unwired or incomplete user-facing | Stub IPC, settings not persisted, silent composer failures |
| **P2** | Inconsistency or duplication | Token drift, duplicate error formatters |
| **P3** | Improvement with clear ROI | Perf, DX, security hardening |

## Verification Commands

```bash
pnpm build
pnpm vitest <path-or-pattern>
```

Run targeted Vitest for each fix batch; full build after renderer/CSS changes.
