# Electron E2E smoke (Playwright)

Vyotiq ships a minimal **Playwright + Electron** smoke suite under `tests/e2e/`. It launches the real app (main, preload, renderer) against the **electron-vite build output** (`out/`), not Vitest mocks.

## Why Playwright `_electron`?

- [Playwright Electron API](https://playwright.dev/docs/api/class-electron) — experimental CDP-based automation for Electron main + renderer.
- [Electron automated testing guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing) — official recommendation to use Playwright Test with `_electron.launch()`.
- electron-vite projects typically **build before E2E**; the dev HMR server is not used for CI smoke (see [electron-vite-react Playwright discussion](https://github.com/electron-vite/electron-vite-react/issues/86)).

## Commands

| Script | What it does |
|--------|----------------|
| `pnpm run smoketest` | Build if `out/main/index.js` is missing, then run Playwright |
| `pnpm run smoketest-no-compile` | Run Playwright without forcing a rebuild (still builds when `out/` is absent unless `VYOTIQ_E2E_SKIP_BUILD=1`) |
| `pnpm run test:e2e` | Alias for `smoketest` |
| `pnpm run test:e2e:ui` | Playwright UI mode (debug) |

First-time setup (Node.js ≥ 22, pnpm ≥ 11):

```bash
pnpm run install:hardened
pnpm run smoketest
```

See [`supply-chain-security.md`](supply-chain-security.md) for install hardening.

## Vitest Browser Mode (future)

Vyotiq unit tests today use Vitest in Node/happy-dom for speed. Vitest 4’s stable **Browser Mode** (Playwright provider) is the recommended path for component tests that need real DOM/CSS behavior (focus traps, tokenized z-index, composer pickers) without expanding the Playwright E2E surface. Adopt incrementally for high-value renderer components; keep `pnpm run smoketest` as the thin cross-process IPC gate.

## What the smoke tests assert

1. Main `BrowserWindow` opens; document title is **Vyotiq — Agent V**.
2. `#root` and `[data-testid="vyotiq-shell"]` are visible.
3. Title bar **Menu** button is present (`aria-label="Menu"`).
4. `window.vyotiq.app.info()` returns version + isolated `userDataDir`.
5. Fresh profile shows **Open a workspace to begin** *or* composer when seeded.
6. `settings.get()` and `workspace.list()` IPC respond.
7. Composer clipboard paste (`composer.clipboard-paste.spec.ts`) — seeds a workspace + conversation, stubs `attachments.ingestClipboardImage`, dispatches a synthetic image paste, and asserts the attachment card appears.
8. Composer skill slash commands (`composer.skills.spec.ts`) — `/` picker, status strip hint, unknown-skill Create dialog, cancel, and on-disk `SKILL.md` creation.
9. Skills IPC (`skills.ipc.spec.ts`) — `window.vyotiq.skills.list` / `read` / `create` against the real main-process registry (bundled + workspace skills).
10. Settings skills panel (`settings.skills.spec.ts`) — Settings → Agent behavior → Skills: bundled list, Built-in filter, New skill dialog, copy-slash control.
11. Settings navigation (`settings.navigation.spec.ts`) — `Mod+,` open, Agent behavior sub-nav, dock **Back to chat**.
12. Composer task tray (`composer.tasks.spec.ts`) — `tasks:set` IPC hydration, progress summary, expand to show task rows.
13. Claude Code proxy (`proxy.claude-code-proxy.spec.ts`) — lists proxy provider and discovers models when `http://127.0.0.1:18765/healthz` is healthy (skipped otherwise).
14. Chat landing discoverability (`chat.landing.spec.ts`) — ready-state git context above centered composer.
15. Dock unified search (`dock.search.spec.ts`) — `Mod+K` / titlebar search button, skills group filter.
16. Dock scheduled runs (`dock.scheduled-runs.spec.ts`) — toolbar popover lists enabled schedules; **Manage…** deep-links to Settings → Scheduled runs.
17. GitHub IPC (`github.ipc.spec.ts`) — `github.listAccounts` and PAT format validation on the real preload bridge.
18. Settings GitHub panel (`settings.github.spec.ts`) — Workspace data empty state, OAuth client ID field, **Open from GitHub…** opens the unified dialog.
19. Open workspace dialog (`workspace.open-dialog.spec.ts`) — Settings **Add workspace…** opens the unified dialog on the local tab.
20. Open workspace GitHub (`workspace.open-dialog.github.spec.ts`) — scope pills filter user/org repos; **Recent** list from seeded catalogue; partial clone retry banner; recent repo opens workspace when clone exists.
21. Chat landing sync suffix (`chat.landing.spec.ts`) — git context line shows `main ↑2 ↓1` when stubbed upstream drift exists.
22. Composer branch chip (`composer.branch-chip.spec.ts`) — GitHub-bound workspace shows `main ↑2 ↓1` on the status strip chip.
23. Dock GitHub entry (`dock.github.spec.ts`) — header **Open from GitHub** and empty-state **From GitHub** open the unified dialog.
24. Settings GitHub seeded account (`settings.github.spec.ts`) — connected account shows verified timestamp and **Re-verify** control.

## Architecture

```
playwright.config.ts          # workers: 1 (single-instance lock)
tests/e2e/
  global-setup.ts             # pnpm run build when out/ missing
  fixtures/electron.fixture.ts
  helpers/paths.ts            # repo root, out/main/index.js, temp userData
  helpers/stubDialogs.ts      # mock native dialogs in main process
  helpers/seedComposerSession.ts  # workspace/conversation seed + clipboard paste helpers
  helpers/settingsNavigation.ts   # openSettings, openAgentBehaviorSection, closeSettings
  smoke.launch.spec.ts
  composer.clipboard-paste.spec.ts
  composer.skills.spec.ts
  skills.ipc.spec.ts
  settings.skills.spec.ts
  settings.navigation.spec.ts
  composer.tasks.spec.ts
  proxy.claude-code-proxy.spec.ts
  chat.landing.spec.ts
  dock.search.spec.ts
  dock.scheduled-runs.spec.ts
  workspace.open-dialog.github.spec.ts
  composer.branch-chip.spec.ts
  dock.github.spec.ts
  helpers/seedGitHub.ts
  helpers/seedGitHubClone.ts
  helpers/stubWorkspaceGitStatus.ts
```

### Launch options (security + isolation)

| Practice | Implementation |
|----------|----------------|
| Isolated profile | `ELECTRON_USER_DATA` → temp `vyotiq-e2e-*` dir per test worker |
| Single instance | `workers: 1` — Vyotiq uses `requestSingleInstanceLock()` |
| Unfused Electron | Launch `node_modules/electron` — **not** fuse-hardened `release/win-unpacked/Vyotiq.exe` |
| Native dialogs | Stubbed via `electronApp.evaluate()` in main process |
| Teardown | `electronApp.close()` in fixture; temp userData removed |
| Logging | `VYOTIQ_LOG_LEVEL=warn`, `NODE_ENV=test` |

**Important:** Packaged binaries with `EnableNodeCliInspectArguments = false` ([`scripts/flipFuses.mjs`](../scripts/flipFuses.mjs)) **cannot** be driven by Playwright. Smoke always targets the **dev Electron binary** + `out/` bundle.

## CI notes

- **Windows / macOS:** run `pnpm run smoketest` after unit tests.
- **Linux headless:** may require a virtual display (`xvfb-run pnpm run smoketest`) depending on the runner image.
- Set `CI=1` for GitHub reporter + one retry.
- Artifacts: `test-results/`, `playwright-report/` (gitignored).

## Extending

- Prefer **role/aria** selectors (`getByRole`, `getByLabel`) over CSS classes.
- Add `data-testid` only on stable shell landmarks (see `vyotiq-shell` on `App.tsx`).
- Seed workspaces/providers by writing fixture JSON under `ELECTRON_USER_DATA` instead of OS folder pickers.
- For packaged-binary smoke, use a **separate** job that does not use Playwright CDP (manual or image-diff harness).

## References (2026)

- [Playwright Electron class](https://playwright.dev/docs/api/class-electron) — launch options, dialog mocking, fuse note
- [Electron automated testing](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [Playwright best practices — Electron patterns](https://github.com/currents-dev/playwright-best-practices-skill/blob/HEAD/testing-patterns/electron.md)
