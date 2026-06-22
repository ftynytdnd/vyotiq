---
name: vyotiq-ui-layout
description: Extends Vyotiq Shell Mono layout (titlebar, left dock, chat-primary workbench, companion pane, timeline progressive disclosure) using existing React/Zustand/Tailwind v4 patterns — never greenfield IDE shells. Use when building or changing UI layout, workbench shell, dock, timeline rows, composer chrome, companion deck, titlebar, or when the user mentions AppLayout, activity bar, multi-pane layout, or /vyotiq-ui-layout.
---

# Vyotiq UI Layout

## Mission

Extend Vyotiq's **existing** Shell Mono UI for layout and timeline work. Agent V runs in a frameless Electron shell: chat/timeline is the primary left column; editor/terminal/browser is an optional resizable right companion. **Search before creating; extend before replacing.**

**Authoritative context:** `AGENTS.md`, `project.md`, `.cursor/rules/vyotiq-ui-layout.mdc`, `.cursor/rules/vyotiq-consistency.mdc`.

For the full zone map, component index, stack details, and anti-patterns, see [reference.md](reference.md).

## Quick layout truth

```
App.tsx
├── TitleBar (dock + workbench chrome in titlebar — not a vertical icon rail)
├── LeftDock (optional flyout: workspaces → chats → files)
└── WorkbenchShell
    ├── LEFT: ChatPage → Timeline + Composer  (agent-primary)
    └── RIGHT: CompanionDeck (when active: editor | terminal | browser | preview)
SettingsFullView replaces workbench when open.
```

**Wrong mental model:** VS Code Activity Bar + 30% agent side panel + 70% code main stage.

## Workflow

Copy and track progress:

```
Task Progress:
- [ ] Step 1: Read zone entry points + adjacent components
- [ ] Step 2: Grep for overlapping UI/patterns
- [ ] Step 3: Implement minimal diff using existing abstractions
- [ ] Step 4: Wire stores/IPC; cleanup listeners on unmount
- [ ] Step 5: Vitest + pnpm build
```

### Step 1 — Read before touching

| Change area | Start here |
|-------------|------------|
| App shell / padding | `src/renderer/App.tsx` |
| Workbench split | `src/renderer/components/workbench/WorkbenchShell.tsx` |
| Chat + timeline column | `src/renderer/pages/ChatPage.tsx`, `components/timeline/Timeline.tsx` |
| Composer footer | `src/renderer/components/composer/`, `pages/ChatFooter.tsx` |
| Dock flyout | `src/renderer/components/dock/LeftDock.tsx`, `DockNavigator.tsx` |
| Titlebar chrome | `src/renderer/components/titlebar/TitleBar.tsx`, `TitlebarChrome.tsx` |
| Companion pane | `src/renderer/components/workbench/CompanionDeck.tsx` |
| Tokens / feature CSS | `src/renderer/index.css`, `styles/dock-flyout.css`, `styles/shell-chrome.css` |
| Shared chrome | `src/renderer/components/ui/SurfaceShell.tsx` |

### Step 2 — Search before creating

```bash
# Example probes — adapt to the feature
rg "InvocationShell|DetailShell|SurfaceShell" src/renderer/components/timeline
rg "WorkbenchShell|CompanionDeck" src/renderer/components/workbench
rg "dockExpanded|workbenchPaneWidth" src/renderer/store
```

Extend existing modules under `src/renderer/components/{timeline,dock,workbench,composer,titlebar}/`. One concern per file; feature folders, not monoliths.

### Step 3 — Implement with existing abstractions

**Layout state** — `useUiStore` (`dockExpanded`, `dockWidth`, `workbenchPaneWidth`, `workbenchTab`), not new React context for pane widths.

**Timeline state** — `useChatStore` + reducer/deriveRows. `Timeline.tsx` is a pure renderer; do not mirror streaming state into another store.

**New timeline row or tool UI:**
- Rows → `src/renderer/components/timeline/rows/`
- Tool invocations → `src/renderer/components/timeline/tools/` sharing `InvocationShell`
- Expand/collapse → `useTimelineRowExpand` + `TimelineRowHeader`
- Detail bodies → `DetailShell` or `SurfaceShell`

**New dock/workbench chrome:** reuse `chromeToolbarButtonClassName`, `chromePillClassName`, `vx-*` utilities from `SurfaceShell.tsx`.

**Diffs:** inline in timeline via `FileChangeCard` / `SnippetDiffBody` / `EditInvocation`; workbench editor for open files; `DiffViewer` for review line-pick only — not a full-window split diff canvas.

### Step 4 — Integrate fully

- Typed IPC: `src/shared/types/ipc.ts` when behavior crosses main/renderer
- Settings persistence when user-facing prefs change
- Leak-safe: `useEffect` cleanup, `removeListener`, clear timers (desktop always-on agent)
- No placeholder handlers or TODO-only user paths

### Step 5 — Verify

```bash
pnpm vitest tests/renderer/<relevant-area>
pnpm build
```

Add Vitest when behavior is non-trivial. Do not create git commits unless asked.

## Design principles (Shell Mono)

1. **Data drives UI** — content (code, diffs, logs) dictates layout; timeline inline diffs are primary.
2. **Progressive disclosure** — collapsed summary → expanded detail via existing row/invocation shells.
3. **Invisible chrome** — whitespace, alignment, typography over heavy borders; `@theme` tokens only.
4. **Semantic state** — `accent`, `accent-gold` (streaming), `success*`, `danger*`, `warning*` from `index.css`; no hardcoded hex.
5. **Preserve behavior** — do not redesign unrelated surfaces; match neighboring spacing/hover/selection.

## Output expectations

When proposing layout work, show **focused diffs against existing files** — not a standalone greenfield `AppLayout` that ignores repo structure.

## Additional resources

- Full zone architecture, stack, row types, anti-patterns: [reference.md](reference.md)
