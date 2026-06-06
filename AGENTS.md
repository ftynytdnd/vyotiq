## Learned User Preferences

- Never assume, guess, or speculate — verify, confirm, and validate with codebase evidence, logs, screenshots, or terminal output before reporting or fixing issues.
- When implementing attached plans: do not edit the plan file; use existing todos (do not recreate); mark items in progress; finish all todos before stopping.
- Before large features or refactors: analyze the full codebase and ask brief, concise clarifying questions first.
- Preserve existing Shell Mono styling, layout, and UX patterns when fixing bugs or adding features — do not redesign unrelated surfaces.
- Do not hardcode provider or model capabilities; dynamically discover models, context windows, and thinking/reasoning support via provider APIs.
- When implementing provider or model features, research current (2026) docs and APIs online rather than relying on stale assumptions.
- Model picker UX: group providers into categories, left-align model IDs, and place thinking-effort controls inline next to each model (not a separate dropdown).
- Take the time needed for thorough work; keep features in structured, modular files and folders rather than monolithic files.
- Create git commits only when the user explicitly asks.
- Remove Cursor-branded or Cursor-style UI references from Vyotiq where the user has corrected this.
- Bug and screenshot analysis should be end-to-end (conversation logs, app logs, code paths) with root causes verified.
- After plan-driven implementation, re-check the plan for missed items, gaps, duplications, and dead code.

## Learned Workspace Facts

- Vyotiq is the product; Agent V is a single solo agent with direct tool access — no sub-agent or delegation architecture.
- Stack: Electron (main/renderer IPC), React, TypeScript, Vite (electron-vite), Zustand; Tailwind CSS v4 CSS-first tokens in `src/renderer/index.css` (`@theme`, no `tailwind.config.js`).
- Shell Mono design system: stealth-dark oklch palette, Geist Sans/Mono, chromeless timeline (no chat bubbles), frameless three-column shell.
- Agent behavior is governed by natural-language harness markdown in `src/main/harness/` — not hardcoded orchestration scripts.
- AI providers use raw HTTP only (no vendor SDKs); models are discovered via `GET /v1/models` on each provider base URL.
- Tools live in separate files under `src/main/tools/`; exposure is controlled by `src/main/tools/policy/`.
- `project.md` at repo root is the authoritative product and architecture specification.
- Primary dev OS is Windows (PowerShell); shell command labels in the timeline must match the actual execution environment.
- Runtime app data and logs live under `%APPDATA%\vyotiq\vyotiq\` (conversations, logs).
- Orchestrator loop lives under `src/main/orchestrator/loop/` (e.g. `runLoop.ts`, `handleToolCalls.ts`).
- Timeline UI is under `src/renderer/components/timeline/` with state in `useChatStore` and `useTimelineUiStore`.
- Provider thinking effort and context-window logic is centralized in `src/shared/providers/thinkingEffort.ts`.
- HTML report deliverables: Settings → Agent behavior → Reports (`settings.ui.reports`) controls auto-open, in-app report BrowserWindow, host ask_user gate after large edits, and the token-costing AI report footer button; free Quick summary uses `reports:generate-run-summary` (zero tokens).
