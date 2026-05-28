---
name: Complete Redesign Review
overview: "Master remediation plan — code review, 7-screenshot audit, full questionnaire. Canonical: Cursor plan complete_redesign_review_04298d5a.plan.md"
todos:
  - id: phase-1-backend
    content: "Phase 1 — Review IPC, gates, read encoding + garbled detection"
    status: pending
  - id: phase-2-shell-overlays
    content: "Phase 2 — Responsive overlays, bottom sheets, panel widths all types, launch closed"
    status: pending
  - id: phase-3-attachments
    content: "Phase 3 — Unified attach, square thumbnails, preview, GC conv-delete, image copy"
    status: pending
  - id: phase-4-composer-settings
    content: "Phase 4 — Merged pill, footer+tok/s, model picker, Permissions merge, Inspector, first-launch Appearance"
    status: pending
  - id: phase-5-diff
    content: "Phase 5 — Single DiffViewer + listGitRefs"
    status: pending
  - id: phase-6-timeline-trace
    content: "Phase 6 — AgentTrace, timeline UX, delegate files, summary collapse"
    status: pending
  - id: phase-7-perf-updates
    content: "Phase 7 — RAM, memory last-ref, toasts, updater, density/scrollbars"
    status: pending
  - id: phase-8-cleanup-tests
    content: "Phase 8 — LoadingHint sweep, dock polish, dead code, tests, knip"
    status: pending
isProject: false
---

# Complete UI Redesign — Review (workspace copy)

> **Full plan:** Cursor `complete_redesign_review_04298d5a.plan.md` — includes all findings, screenshots, and **complete questionnaire coverage** (§1 + §1b + POL-1–14).

Spec: [complete-redesign.md](complete-redesign.md) — marked completed; implementation **partial**.

---

## Finding counts (updated)

| Severity | Count | ID ranges |
|----------|-------|-----------|
| Critical | 3 | SC-C1 – SC-C3 |
| High | 16 | H1–H7, SC-H1 – SC-H6 |
| Medium | 20 | M1–M10, SC-M1 – SC-M10 |
| Low | 11 | L1–L5, SC-L1 – SC-L6 |
| **Polish (restored)** | **14** | **POL-1 – POL-14** |
| **Total** | **64** | |

---

## Questionnaire coverage (complete)

### Core (§1 in master plan)

Scope all · phased · delete review IPC · wire gates (enforce only, no extra UI) · attachments meta-only · GC conv-delete · merged pill · permission toggle · Copy+Edit · summary collapse · orchestrator-only steps · remove regenerate · keep tool auto-expand · reasoning fade · one diff · memory last-ref · full RAM · salvage subagent folder · panels closed on launch · unified attach · N/10 hidden · square thumbnails · in-app then system · responsive overlays · non-blocking bottom sheets · listGitRefs · ship updater · merge Permissions · provider error-only · outline destructive · full density/scrollbars · full tests

### Shell & polish (restored — was missing)

| Item | ID | Phase |
|------|-----|-------|
| Toasts: errors persistent, others ~4s | POL-1 | 7 |
| Chat rename double-click only | POL-2 | 8 |
| New chat plus / label when expanded | POL-3 | 8 |
| Model picker Recent → Favorites + keyboard | POL-4 | 4 |
| Keep workspace path strip | POL-5 | 4 |
| Inspector wire breakdown expanded | POL-6 | 4 |
| LoadingHint full sweep | POL-7 | 8 |
| Appearance first launch only | POL-8 | 4 |
| Local providers group | POL-9 | 4 |
| Panel width all overlay types | POL-10 | 2 |
| Composer status tok/s | POL-11 | 4 |
| Delegate files refinement | POL-12 | 6 |
| Checkpoints Review-if-pending | POL-13 | 4 |
| Archived collapsed default | POL-14 | 8 |

Also explicit in §1: strict single overlay slot, drag-over highlight, bottom sheet overrides “expand immediately”, gate enforce-only note.

---

## Overrides (later answers win)

| First audit | Final |
|-------------|-------|
| Copy+Edit+Revert | Copy+Edit |
| Hide activity summary | Collapse one line |
| Solid red destructive | Outline + solid hover |
| Bottom sheet expand immediate | Don't block chat |
| GC + sweeper | Conv delete only |

---

## Phases (8)

See master plan §5 for task lists and finding IDs closed per phase.

---

## Success criteria

12 items in master plan §7 (includes questionnaire + POL items complete).
