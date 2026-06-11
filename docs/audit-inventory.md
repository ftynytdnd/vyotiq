# Vyotiq audit inventory (closed)

Ledger of remediation items closed in the 2026-06 full-app pass. Do not resurrect removed subsystems listed here.

## Wired features

- **`report` tool** — registered in registry/policy/harness; writes `.vyotiq/reports/*.html`; `ReportInvocation` timeline UI.
- **Token estimation IPC** — `tokens:estimate` exposes main `tokenCounter`; composer draft estimate via `useComposerTokenEstimate` + `TokenUsagePill`.
- **Inline revert model picker** — `InlinePromptSession` includes `ModelPicker`.
- **Clickable Latest** — `ComposerStatusStrip` calls `requestScrollToTail`; `Timeline` listens via `useTimelineUiStore`.

## Removed / purged

- Web search UI and `mode: 'web'` on `search` tool data (local-only).
- Legacy workspace IPC: `workspace:get`, `workspace:pick`, `workspace:set`.
- Orphans: `AttachmentPicker`, `AboutOverlay`, `useMentionComputerPick`, `synthesizeReportPreview`, `emitToolValidationFailure`, `endpointWarning`, `blobStore`, `settingsGroups`, `parseUnifiedPatch`, unused barrel indexes.
- Mention picker "Coming soon" stub rows.
- `ModelPickerProviderLabel` (unused).

## Intentional survivors (not removals)

- Transcript-only rewind / `previewRewind` / `rewindToPrompt` / `InlinePromptSession`.
- `TokenUsagePill` run usage display.
- `recordChange` stub for tool card `entryId` metadata (no blob persistence).
- Checkpoint event kinds in shared types for legacy transcript load (no new emissions).

## Refactor landed

- `AttachmentChipRow` replaces `AttachmentCollapsible`.
- Timeline virtualization (`VirtualizedTurnList` at 50+ rows).
- `ChatComposerZone` width wrapper deduplicated (width owned by `ChatFooter`).

## Known test limitations (documented, not regressions)

- `TimelineAutoScroll.test.tsx` — one case skipped: happy-dom does not model scroll metrics reliably for off-tail auto-scroll.
- `timelineAlignment.test.tsx` — jump-chip backdrop case skipped: portal layout differs from production Electron shell.

## Verification (2026-06 pass)

- `npm run typecheck` — pass
- `npm test` — 1867+ passed, 2 skipped (happy-dom limits above)
- `npm run knip` — 0 unused files under `src/`
- `npm run build