# Electron E2E smoke (Playwright)

Vyotiq ships a minimal **Playwright + Electron** smoke suite under `tests/e2e/`. It launches the real app (main, preload, renderer) against the **electron-vite build output** (`out/`), not Vitest mocks.

## Why Playwright `_electron`?

- [Playwright Electron API](https://playwright.dev/docs/api/class-electron) — experimental CDP-based automation for Electron main + renderer.
- [Electron automated testing guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing) — official recommendation to use Playwright Test with `_electron.launch()`.
- electron-vite projects typically **build before E2E**; the dev HMR server is not used for CI smoke (see [electron-vite-react Playwright discussion](https://github.com/electron-vite/electron-vite-react/issues/86)).

## Commands

| Script | What it does |
|--------|----------------|
| `npm run smoketest` | Build if `out/main/index.js` is missing, then run Playwright |
| `npm run smoketest-no-compile` | Run Playwright without forcing a rebuild (still builds when `out/` is absent unless `VYOTIQ_E2E_SKIP_BUILD=1`) |
| `npm run test:e2e` | Alias for `smoketest` |
| `npm run test:e2e:ui` | Playwright UI mode (debug) |

First-time setup after `npm install`:

```bash
npm install
npm run smoketest
```

## What the smoke tests assert

1. Main `BrowserWindow` opens; document title is **Vyotiq — Agent V**.
2. `#root` and `[data-testid="vyotiq-shell"]` are visible.
3. Title bar **Menu** button is present (`aria-label="Menu"`).
4. `window.vyotiq.app.info()` returns version + isolated `userDataDir`.
5. Fresh profile shows **Open a workspace to begin** *or* composer when seeded.
6. `settings.get()` and `workspace.list()` IPC respond.
7. Composer clipboard paste (`composer.clipboard-paste.spec.ts`) — seeds a workspace + conversation, stubs `attachments.ingestClipboardImage`, dispatches a synthetic image paste, and asserts the attachment card appears.

## Architecture

```
playwright.config.ts          # workers: 1 (single-instance lock)
tests/e2e/
  global-setup.ts             # npm run build when out/ missing
  fixtures/electron.fixture.ts
  helpers/paths.ts            # repo root, out/main/index.js, temp userData
  helpers/stubDialogs.ts      # mock native dialogs in main process
  helpers/seedComposerSession.ts  # workspace/conversation seed + clipboard paste helpers
  smoke.launch.spec.ts
  composer.clipboard-paste.spec.ts
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

- **Windows / macOS:** run `npm run smoketest` after unit tests.
- **Linux headless:** may require a virtual display (`xvfb-run npm run smoketest`) depending on the runner image.
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
