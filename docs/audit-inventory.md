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
- **Vector memory** — sqlite-vec hybrid index under `.vyotiq/`; upgraded `retrieval.ts`.
- **ast-grep search** — structural mode on `search` tool via `@ast-grep/napi`.
- **Secondary-zone editor + PTY** — CodeMirror 6 editor; shared `node-pty` terminal bridged to agent `bash`.
- **Inline completion** — editor ghost text + composer prompt continuation via completion IPC.
- **Distribution** — electron-builder packaging, fuse hardening, electron-updater with About-panel install path.

## Removed / purged

- Web search UI and `mode: 'web'` on `search` tool data (local-only).
- Legacy workspace IPC: `workspace:get`, `workspace:pick`, `workspace:set`.
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
- `npm test` — 2217 passed, 2 skipped (happy-dom limits above)
- `npm run build` — pass
