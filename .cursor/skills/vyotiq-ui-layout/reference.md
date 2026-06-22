# Vyotiq UI Layout — Reference

Detailed architecture for the **vyotiq-ui-layout** skill. Read when implementing layout, timeline, dock, workbench, or titlebar changes.

## Product context

- **Vyotiq** — Electron desktop app; **Agent V** — single solo agent with direct tool access (no sub-agents, no delegation).
- Behavior: natural-language harness in `src/main/harness/`; tools in `src/main/tools/`; orchestrator in `src/main/orchestrator/loop/`.
- UI aesthetic: **Shell Mono** — stealth-dark oklch palette, Geist Sans/Mono, chromeless timeline, frameless workbench.

## Layout zones

### Zone 1 — Frameless title bar

**Files:** `src/renderer/components/titlebar/TitleBar.tsx`, `TitlebarChrome.tsx`, `titlebarShared.ts`, `WindowControls.tsx`

- Hamburger menu + window controls; integrated horizontal chrome (not a separate vertical Activity Bar).
- `TitlebarDockChrome` — `DockToolbar` in titlebar: new chat, collapse/expand flyout, search, settings.
- `TitlebarWorkbenchChrome` — `WorkbenchLaunchers`: editor, terminal, browser.
- Center breadcrumb when Settings is open.
- Run/status indicators belong in **composer/timeline chrome**, not a centralized pulsing titlebar dot (unless explicitly requested).

### Zone 2 — Left dock flyout (optional, resizable)

**Files:** `src/renderer/components/dock/LeftDock.tsx`, `DockNavigator.tsx`, `DockWorkspaceFolder.tsx`, `DockChatStrip.tsx`, `DockFilesPanel.tsx`, `DockSearchPopover.tsx`, `dockShared.ts`, `styles/dock-flyout.css`

- Toggleable flyout from left edge; width in `useUiStore.dockWidth`; resize handle in `LeftDock`.
- Inline Repositories-style tree: workspaces → nested chats → files.
- Collapses while Settings is open; toolbar lives in titlebar.
- **No** Graphify/Visualization view — not part of Vyotiq.

### Zone 3 — Workbench main canvas (agent-primary LEFT)

**Files:** `src/renderer/components/workbench/WorkbenchShell.tsx`, `src/renderer/pages/ChatPage.tsx`, `src/renderer/components/timeline/Timeline.tsx`, composer under `src/renderer/components/composer/`

- Agent chat + timeline is the **primary left column** (not a narrow 30% side panel).
- `Timeline` renders derived rows from `useChatStore` (pure renderer — streaming state in store/reducer).
- `ChatFooter` / `Composer` pinned below timeline.
- Width adapts via `timelineContentWidthClass()` when companion pane is open.

### Zone 4 — Companion deck (optional RIGHT pane)

**Files:** `src/renderer/components/workbench/CompanionDeck.tsx`, `WorkbenchTabBar.tsx`, `WorkbenchResizeHandle.tsx`, `EditorCanvas.tsx`, `TerminalCanvas.tsx`, `BrowserCanvas.tsx`, `PreviewCanvas.tsx`

- Opens when editor, terminal, browser, or preview is active (`useWorkbenchActive()`).
- Resizable via `WorkbenchResizeHandle`; width in `useUiStore.workbenchPaneWidth`.
- Tab bar: Terminal | Globe | file tabs…
- Agent `bash` PTY persists in main even when terminal UI is detached.

### Zone 5 — Settings overlay

**Files:** `src/renderer/components/settings/`, `SettingsFullView`

- Full-view replacement of workbench when open — not a bottom-pinned settings rail.

## App entry composition

```tsx
// src/renderer/App.tsx (conceptual)
<div>
  <LeftDock />
  <TitleBar />
  <main style={{ paddingTop: titlebar, paddingLeft: dock inset }}>
    {settingsOpen ? <SettingsFullView /> : (
      <WorkbenchShell>
        <ChatPage />
      </WorkbenchShell>
    )}
  </main>
</div>
```

## Tech stack (do not substitute)

| Layer | Choice |
|-------|--------|
| Desktop | Electron; main/renderer separation; typed IPC `src/shared/types/ipc.ts` |
| Frontend | React + TypeScript + Vite 8 (electron-vite 6) |
| State | Zustand (`useChatStore`, `useUiStore`, `useWorkspaceStore`, `useEditorStore`, `useSettingsStore`, …) |
| Styling | Tailwind CSS v4 CSS-first — `@theme` in `src/renderer/index.css`; **no** `tailwind.config.js` |
| Icons | `lucide-react`; `shellIcons.ts` for shared stroke/size |
| Fonts | Geist Sans + Geist Mono |
| Utilities | `cn()` from `src/renderer/lib/cn.js` |

## Design tokens (Shell Mono)

From `src/renderer/index.css` `@theme`:

- Surfaces: `surface-base`, `surface-raised`, `surface-overlay`, `surface-sidebar`, `surface-input`
- Text: `text-primary`, `text-secondary`, `text-muted`, `text-faint`
- Accent: `accent`, `accent-soft` (focus, links, CTA); `accent-gold` (live streaming labels)
- State: `success*`, `danger*`, `warning*` soft/strong variants
- **Never** hardcode hex in components (e.g. avoid `bg-[#18181A]`).

## Shared UI abstractions

| Abstraction | Path | Use for |
|-------------|------|---------|
| `SurfaceShell` | `components/ui/SurfaceShell.tsx` | Bordered inset shells, popover panels, code surfaces |
| `InvocationShell` | `timeline/tools/shared/InvocationShell.tsx` | Collapsed tool log line → expanded detail |
| `DetailShell` | `timeline/shared/DetailShell.tsx` | Expanded payload/log bodies |
| `TimelineRowHeader` | `timeline/shared/TimelineRowHeader.tsx` | Row expand/collapse chrome |
| `TurnBlock` | `timeline/shared/TurnBlock.tsx` | Turn-scoped grouping |
| `useTimelineRowExpand` | `timeline/shared/useTimelineRowExpand.tsx` | Expand state + live auto-expand |

Feature CSS: `dock-flyout.css`, `shell-chrome.css`, `titlebar-menu.css`.

## Timeline row types

| Category | Components |
|----------|------------|
| User/assistant | `UserPromptRow`, `AssistantTextRow`, `ReasoningLineRow`, `AgentThoughtRow`, `AssistantImageRow` |
| Tools | Per-tool `*Invocation.tsx` under `timeline/tools/` (bash, read, edit, search, sg, memory, …) |
| Edits | `FileEditGroupRow`, `FileChangeCard`, diff under `timeline/tools/edit/diff/` |
| Interactive | `AskUserRow`, `AskUserOverlay` |
| System | `ErrorRow`, `RunCompleteRow`, `ContextReductionRow`, `ToolGroupRow` |

**Hidden tools** (settle in log, no activity row): `finish`, `ask_user`, `todos`, `heartbeat`, `continue` — see `isTimelineHiddenTool`.

**Progressive disclosure pattern:**

```tsx
// Pattern: InvocationShell + optional DetailShell body
<InvocationShell
  title="read"
  summary="src/foo.ts"
  ok={true}
  rowKey={rowKey}
  detail={<DetailShell>...</DetailShell>}
/>
```

## Resizable panels (already implemented)

| Panel | Mechanism | Store |
|-------|-----------|-------|
| Left dock | `LeftMouseDown` on separator in `LeftDock` | `useUiStore.setDockWidth` |
| Companion pane | `WorkbenchResizeHandle` | `useUiStore.workbenchPaneWidth` |

Do not reimplement drag-resize unless extending these hooks.

## Anti-patterns (never)

- Scaffold new `AppLayout` replacing `App.tsx` / `WorkbenchShell`
- VS Code-style vertical Activity Bar (Files / Chat / Graph / Search icons)
- Timeline in 30% collapsible side panel; code as 70% “main stage”
- Next.js, shadcn-as-primary-styling, hardcoded colors, `tailwind.config.js`
- Central titlebar pulsing agent status
- Full-window split diff as primary canvas (use inline timeline diffs + workbench editor)
- Revive: phased execution UI, tool re-run, reflective autonomy, sub-agent delegation
- Redesign Shell Mono or introduce parallel styling systems

## Implementation checklist

1. Read zone entry points + adjacent components.
2. Grep for overlap; list files to touch.
3. Extend existing abstractions; minimal diff.
4. Wire Zustand + typed IPC + settings if needed.
5. Cleanup listeners/timers on unmount.
6. `pnpm vitest tests/renderer/<area>` + `pnpm build`.

## Prompt template (for external LLM sessions)

When delegating layout work outside Cursor, use this role/context block:

```markdown
[ROLE]
Expert UI/UX engineer on **Vyotiq** — Electron AI coding agent (Agent V, solo agent, no delegation).
**Extend** existing Shell Mono UI; do not greenfield a VS Code clone.

[LAYOUT]
TitleBar (integrated dock/workbench chrome) + optional LeftDock flyout +
WorkbenchShell: chat/timeline PRIMARY LEFT, CompanionDeck optional RIGHT.
Settings = full overlay. Resizing via useUiStore.

[STACK]
React + TS + Vite 8 + electron-vite 6 + Zustand + Tailwind v4 @theme + lucide-react.
Tokens in src/renderer/index.css; SurfaceShell / InvocationShell / vx-* utilities.

[TASK]
Read existing entry points; grep for overlap; implement focused diffs;
wire stores/IPC; Vitest + pnpm build. No placeholder UI.
```
