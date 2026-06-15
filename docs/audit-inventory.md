# Vyotiq audit inventory (closed)

Ledger of remediation items closed in the 2026-06 full-app pass. Do not resurrect removed subsystems listed here.

## Wired features

- **`report` tool** — registered in registry/policy/harness; writes `.vyotiq/reports/*.html`; `ReportInvocation` timeline UI.
- **Token estimation IPC** — `tokens:estimate` exposes main `tokenCounter`; composer draft estimate via `useComposerTokenEstimate` + `TokenUsagePill`.
- **Inline revert model picker** — `InlinePromptSession` includes `ModelPicker`.
- **Clickable Latest** — `ComposerStatusStrip` calls `requestScrollToTail`; `Timeline` listens via `useTimelineUiStore`.
- **Checkpoint file restore** — `blobStore` + `recordChange` persist pre/post bodies; pending accept/reject UI; `previewRewind` / `rewindToPrompt` restore on-disk files and truncate JSONL.
- **Transcript export** — `conversations:export` → JSONL or Markdown via native save dialog (dock chat strip).
- **Transcript pagination** — tail slice on load + `readBefore` / `TranscriptLoadEarlier` for long chats.
- **Harness lab** — Settings → Agent behavior harness viewer/editor with userData overrides merged at boot.
- **Vector memory** — sqlite-vec hybrid index under `.vyotiq/`; upgraded `retrieval.ts`; hash embedder default.
- **ast-grep search** — default AST `search` tool via `@ast-grep/napi` + bundled `@ast-grep/cli`; `sg` tool for run/scan/test.
- **Workbench editor + PTY** — CodeMirror 6 editor; shared `node-pty` terminal bridged to agent `bash`; `WorkbenchShell` top tabs + main canvas (no right column).
- **Inline completion** — editor ghost text + composer prompt continuation via completion IPC.
- **Distribution** — electron-builder packaging, fuse hardening, electron-updater with About-panel install path (docs/manual update path; no forced auto-update channel).
- **Vector re-index** — Settings → Agent behavior → Vector memory manual re-index; embedder/Ollama model changes trigger `reindexAllWorkspacesIfVectorMemoryChanged` on settings save.
- **Checkpoint blob preview** — Settings → Agent behavior → Checkpoints expands pending rows via `readBlob` pre/post hashes and `SnippetDiffBody` hunks.
- **Terminal detach** — closing the terminal tab calls `terminal:detach` (renderer detach only); PTY session survives for agent `bash` reuse.
- **Editor LSP** — optional stdio LSP bridge (Settings → Agent behavior → Editor LSP): diagnostics, hover, Ctrl+Space completion, F2 rename, Shift+F12 find references, Mod+. code actions, F12 / Alt+click go-to-definition in CodeMirror; cross-file navigation via `VyotiqLspWorkspace.displayFile`.
- **Edit encoding parity** — `read`/`edit`/editor preserve UTF-8/16/32 BOM and EOL via `src/main/text/decodeDiskText.ts`.
- **Custom keybindings** — `settings.ui.keybindings` overrides; Settings → Shortcuts; `useGlobalShortcuts`, `useDockShortcuts`, timeline find, and settings Escape use resolved combos.
- **Scheduled runs** — Settings → Agent behavior → Scheduled runs; local interval prompts while Vyotiq is open; defers when conversation has an active run.
- **Memory workspace append** — `memory:write` `mode: 'append'` for workspace notes; Settings → Memory append UI for global and workspace scopes.
- **Agent behavior subnav** — `AgentBehaviorPanel` left sub-navigation (Memory, Vector, LSP, Inline completion, Run limits, Context management, Harness, Checkpoints, Prompt caching, Reports, Scheduled runs).
- **Permissions removal** — legacy `permissionsByWorkspace` and approval-gate maps stripped on settings read/write; tools apply immediately with sandbox checks only.
- **Provider account poll registry** — `useProviderAccountPollSource` mount-only layout effect + deduped snapshot sync (error-boundary safe).

## Removed / purged

- Web search UI and `mode: 'web'` on `search` tool data (local-only).
- Legacy workspace IPC: `workspace:get`, `workspace:pick`, `workspace:set`.
- Per-workspace tool approval gates (`permissionsByWorkspace`, `strictApprovalsByWorkspace`, `gatePromptOnPendingByWorkspace`, and related maps).
- **RightDock / SecondaryZone** — `secondaryZoneMode`, `rightDockWidth`, right-column secondary zone, and overlay companion panels; replaced by workbench shell.
- **Tool re-run** — IPC (`tools:rerun`), shared helpers, timeline UI, and tests removed.
- Orphans: `AttachmentPicker`, `AboutOverlay`, `useMentionComputerPick`, `synthesizeReportPreview`, `emitToolValidationFailure`, `endpointWarning`, `settingsGroups`, `parseUnifiedPatch`, unused barrel indexes.
- Mention picker "Coming soon" stub rows.
- `ModelPickerProviderLabel` (unused).

## Intentional survivors (not removals)

- `TokenUsagePill` run usage display.
- Checkpoint event kinds in shared types for legacy transcript load (older transcripts without blobs still rewind transcript-only).

## Refactor landed

- `AttachmentChipRow` replaces `AttachmentCollapsible`.
- Timeline virtualization (`VirtualizedTurnList` at 50+ rows).
- `ChatComposerZone` width wrapper deduplicated (width owned by `ChatFooter`).

## Known test limitations (documented, not regressions)

- `TimelineAutoScroll.test.tsx` — one case skipped: happy-dom does not model scroll metrics reliably for off-tail auto-scroll.
- `timelineAlignment.test.tsx` — jump-chip backdrop case skipped: portal layout differs from production Electron shell.

## Verification (2026-06 gap-analysis pass)

- `npm run typecheck` — pass
- `npm test` — 2220+ passed, 2 skipped (happy-dom limits above)
- `npm run build` — pass
