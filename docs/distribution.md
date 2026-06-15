# Distribution — signing, notarization, and auto-update

Vyotiq ships distributables via **electron-builder** on top of the electron-vite `out/` bundle.

## Build

```bash
npm run build          # electron-vite → out/
npm run dist           # build + package (current OS)
npm run dist:win       # Windows NSIS installer
npm run dist:mac       # macOS DMG + zip
npm run dist:linux     # Linux AppImage
```

Artifacts land in `release/`.

### Windows native modules

`node-pty`, `@ast-grep/napi`, `@ast-grep/cli`, and `@photostructure/sqlite-vec` ship **prebuilt binaries**. `electron-builder.yml` sets `npmRebuild: false` so packaging does not invoke `node-gyp` (which on Windows often requires **MSVC Spectre-mitigated libraries** from the Visual Studio installer). If you change Electron major versions, run `npx electron-rebuild` locally with a full C++ toolchain before `dist`.

## Fuse hardening

`scripts/afterPackFlipFuses.cjs` runs automatically as an **afterPack** hook (before signing). To harden a binary manually:

```bash
npm run flip-fuses -- path/to/Vyotiq.exe
```

Re-sign after a manual fuse flip if you signed first.

## Code signing

### Windows

Set in CI or locally before `npm run dist:win`:

| Variable | Purpose |
|----------|---------|
| `CSC_LINK` | Path to `.pfx` or base64-encoded certificate |
| `CSC_KEY_PASSWORD` | PFX password |

CI release workflow passes `--config.forceCodeSigning=true` so unsigned production builds fail when `CSC_LINK` is missing. Local `npm run dist` / `dist:dir` omits this flag for unsigned dev packages.

### macOS

| Variable | Purpose |
|----------|---------|
| `CSC_LINK` | Developer ID Application certificate (`.p12`) |
| `CSC_KEY_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Team ID |

`electron-builder.yml` enables `hardenedRuntime`, entitlements (`build/entitlements.mac.plist`), and `notarize: true`.

## Auto-update feed

Packaged builds use **electron-updater** with `autoDownload: true`. Configure the publish URL:

| Variable | Purpose |
|----------|---------|
| `UPDATE_BASE_URL` | HTTPS base URL hosting `latest.yml` / `latest-mac.yml` / `latest-linux.yml` |
| `VYOTIQ_ALLOW_UNSIGNED_UPDATES` | Set to `1` for unsigned local update smoke tests (dev only) |

Upload `release/*` artifacts from CI to that bucket or GitHub Releases. Users see update toasts on launch and can install from **Settings → About**.

## CI release workflow

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds on **tag push** (`v*`) or **workflow_dispatch**:

1. Matrix: `windows-latest`, `macos-latest`, `ubuntu-latest`.
2. Each job runs `npm ci` then `npm run dist:publish` (electron-vite build + electron-builder `--publish always`).
3. Artifacts upload to the workflow run for download; the generic publish URL comes from `UPDATE_BASE_URL`.

### Required repository secrets

| Secret | Used on |
|--------|---------|
| `UPDATE_BASE_URL` | All platforms — HTTPS base for `latest*.yml` + installers |
| `CSC_LINK` | Windows + macOS — signing certificate (path or base64) |
| `CSC_KEY_PASSWORD` | Windows + macOS — certificate password |
| `APPLE_ID` | macOS — notarization Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS — app-specific password |
| `APPLE_TEAM_ID` | macOS — Developer team ID |

Linux AppImage builds in CI are unsigned unless you add a separate signing step.

### Hosting the update feed

The workflow includes a commented **scp/rsync placeholder** after artifact upload. In production, add a deploy job (or post-step) that copies `release/*` — installers plus `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` — to the static host behind `UPDATE_BASE_URL`. Keep filenames stable; electron-updater polls the manifest, not GitHub Releases directly, when using the generic provider.

## Local smoke (unsigned)

```bash
npm run dist:dir
```

Produces an unpacked app in `release/win-unpacked` (or `release/mac` / `release/linux-unpacked`) without an installer. Updater checks are no-ops in dev (`!app.isPackaged`).
