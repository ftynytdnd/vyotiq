## Learned User Preferences

- Never assume, guess, or speculate — verify, confirm, and validate with codebase evidence, logs, screenshots, root  or terminal output before reporting or fixing issues.
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
- Stack: Electron (main/renderer IPC), React, TypeScript, Vite 8 (electron-vite 6), Zustand; Tailwind CSS v4 CSS-first tokens in `src/renderer/index.css` (`@theme`, no `tailwind.config.js`).
- Shell Mono design system: stealth-dark oklch palette, Geist Sans/Mono, chromeless timeline (no chat bubbles), frameless workbench shell (left dock + main canvas).
- Agent behavior is governed by natural-language harness markdown in `src/main/harness/` — not hardcoded orchestration scripts.
- AI providers use raw HTTP only (no vendor SDKs); models are discovered via `GET /v1/models` on each provider base URL.
- Tools live in separate files under `src/main/tools/`; exposure is controlled by `src/main/tools/policy/`.
- `project.md` at repo root is the authoritative product and architecture specification.
- Primary dev OS is Windows (PowerShell); shell command labels in the timeline must match the actual execution environment.
- Runtime app data and logs live under `%APPDATA%\vyotiq\vyotiq\` (conversations, logs).
- Orchestrator loop lives under `src/main/orchestrator/loop/` (e.g. `runLoop.ts`, `handleToolCalls.ts`).
- Timeline UI is under `src/renderer/components/timeline/` with state in `useChatStore` and `useTimelineUiStore`.
- Provider account snapshots: main-process adaptive poller (`PROVIDER_ACCOUNT_POLL_ACTIVE_MS` 5s when picker/composer/settings/agent-run active, 60s idle) fetches host-aware billing — OpenRouter `/v1/key` + `/v1/credits` (Management key for credits; UI CTA on 403), DeepSeek `/user/balance`, OpenAI credit grants + optional Admin usage API, Anthropic Admin cost report, Together `/v1/billing/usage`, xAI Management API prepaid balance via `billingApiKey`, rate-limit headers (+ cold-start probe) for Gemini/Groq/Mistral/generic; pushes `providers:account-updated` to renderer. Background model discovery poller shares poll sources and pushes `providers:models-updated` when pricing/context/thinking changes. Model-list pricing parsed into `ModelInfo.pricing` with `hostModelPricing` fallback on all discovery dialects for cost badges/estimates.
- HTML report deliverables: Settings → Agent behavior → Reports (`settings.ui.reports`) controls auto-open, in-app report BrowserWindow, host ask_user gate after large edits, and the token-costing AI report footer button; free Quick summary uses `reports:generate-run-summary` (zero tokens). Auto-open only fires for live `liveReportResultIds` settlements — not when replaying saved transcripts on startup.
- Timeline edit diffs: per-file change cards (`FileChangeCard` + `SnippetDiffBody`) with syntax-highlighted snippets; unified `DiffViewer` remains for review line-pick only.
- Timeline hidden tools: `finish` and `ask_user` settle in the event log but do not render activity-lane rows — `finish` summary via `assistant-text`; `ask_user` uses dedicated `ask-user-prompt` rows only (`isTimelineHiddenTool` in `timelineHiddenTools.ts`). Submitted answers appear as a compact user bubble (`formatAskUserReplyBubble`); full Q&A with option ids stays in the tool result for the agent.
- Prompt/context caching: cache-layered topology in `buildContextLayers.ts` (static system → `<static_examples>` few-shot → workspace → history → `<runtime_context>` → turn); few-shot from `03-static-examples.md` via `buildStaticFewShotXml()`; provider hints in `src/main/providers/cacheHints/` (Anthropic explicit breakpoints on system/few-shot/workspace/tools + automatic rolling, OpenAI `prompt_cache_key` + tiered cache-read pricing in `cachePricingDefaults.ts`, Gemini hoists system+few-shot+workspace to `systemInstruction`); metrics in `TokenUsage.cachedPromptTokens` / `cacheCreationTokens` / `uncachedPromptTokens` (DeepSeek); Settings → Agent behavior → Prompt caching (`settings.ui.promptCaching`) + composer status strip; audit in `docs/prompt-caching-audit.md`; env overrides `VYOTIQ_CACHE_DIAGNOSTICS`, `VYOTIQ_GEMINI_EXPLICIT_CACHE`.
- Vector re-index: manual re-index in Settings → Agent behavior → Vector memory; changing embedder/Ollama model settings triggers `reindexAllWorkspacesIfVectorMemoryChanged` (`src/main/settings/vectorReindexOnSettings.ts`).
- Editor LSP: optional stdio language-server bridge for the in-app CodeMirror editor only (diagnostics, hover, completion, F2 rename, Shift+F12 find references, Mod+. code actions, F12 / Alt+click go-to-definition) — Settings → Agent behavior → Editor LSP; ships built-in Pyright (Python) and TypeScript Language Server (TS/JS) via Electron-as-Node (no separate install); optional per-language overrides in settings or `.vyotiq/lsp.json`; enabled by default; not wired into agent `search`/`read` tools.
- Workbench shell: `WorkbenchShell` in `src/renderer/components/workbench/` — horizontal split: agent chat stays in the left column; when editor, terminal, or attachment preview opens, a resizable companion pane appears on the right with tab bar `[Terminal | Globe | file tabs…]`, contextual toolbar, and canvas. No right-column `SecondaryZone`. Left dock always visible and auto-switches to Files when a file opens. Workbench tab shortcuts: `Mod+W` close, `Mod+Alt+ArrowUp/Down` cycle. Closing the terminal tab detaches the renderer only (`terminal:detach` is a no-op); the PTY stays alive for agent `bash` reuse. Agent `bash` (default `shared: true`) auto-provisions the workspace primary PTY via `ensureWorkspacePty` on first run — no need to open the terminal panel first; opening the panel later attaches to the existing session via `terminal:attach`.
- Custom keybindings: `settings.ui.keybindings` overrides defaults; Settings → Shortcuts panel + `useGlobalShortcuts` / `useDockShortcuts` / timeline find respect resolved combos. `Mod+S` saves the active editor file when dirty (works from any tab).
- Scheduled runs: Settings → Agent behavior → Scheduled runs — local interval agent prompts while Vyotiq is open; skips dispatch when the target conversation already has an active run (`src/main/scheduler/`).
- Memory workspace append: `memory:write` with `mode: 'append'` appends workspace notes; Settings → Memory exposes append UI for global meta-rules and workspace notes.
- Edit encoding: `read`/`edit`/editor preserve UTF-8/16/32 BOM and EOL via `src/main/text/decodeDiskText.ts`.
- Tool re-run removed entirely (no IPC, timeline UI, or shared helpers).
- Provider account poll registry: `useProviderAccountPollSource` uses mount-only layout effect + deduped snapshot sync (error-boundary safe).
- Tool permissions removed: legacy `permissionsByWorkspace` approval gates purged from settings on read/write; agent tools run immediately subject to `sandbox.ts` checks only.
