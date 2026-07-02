# Voice dictation (future architecture)

Vyotiq previously exposed composer dictation via `ui.dictation` and a `composerDictate` keybinding slot. Those fields are stripped on settings load (`migrateUiFields.ts`). This document describes the recommended path if dictation is revived.

## Goals

- Hands-free prompting in the composer without sending audio to the cloud by default.
- Push-to-talk or toggle via Settings → Shortcuts (restore `composerDictate` binding).
- Leak-safe lifecycle: stop `MediaStream` tracks on unmount; abort transcription workers on workspace switch and app quit.

## Why not Web Speech API alone

- Unreliable in Electron/Chromium builds (cloud dependency, inconsistent availability).
- Audio leaves the device when it works — poor fit for local desktop agent workflows and regulated environments.

## Recommended stack (2026)

1. **Local transcription** — `whisper.cpp` native binary (main process or utility subprocess) **or** `@xenova/transformers` in a dedicated Web Worker with WASM/WebGPU fallback.
2. **Renderer UX** — mic chip in the composer chip row (next to capture), recording indicator in `ComposerStatusStrip`, optional waveform using existing Shell Mono tokens.
3. **IPC** — `dictation:start` / `dictation:stop` / `dictation:partial` / `dictation:final` channels; partial results stream into the composer contenteditable without committing until final or user pause.
4. **Settings** — opt-in toggle under Agent behavior or Shortcuts; model size selector (tiny/base) with disk budget warning; clear “audio stays on device” copy.
5. **Privacy** — no telemetry on raw audio; optional local transcript cache with “clear dictation history” in Settings → Workspace data.

## Integration points

| Layer | File / area |
|-------|-------------|
| Composer UI | `src/renderer/components/composer/Composer.tsx` |
| Keybindings | `src/shared/keybindings/defaultKeybindings.ts`, `resolveKeybindings.ts` |
| Settings schema | `src/main/settings/settingsStore.ts`, `migrateUiFields.ts` |
| Main worker | new `src/main/dictation/` module (spawn whisper or worker bridge) |

## Out of scope until explicitly requested

- System-wide dictation outside the composer.
- Cloud STT fallback without explicit user consent per session.
