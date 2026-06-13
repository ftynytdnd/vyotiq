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

`node-pty`, `@ast-grep/napi`, and `@photostructure/sqlite-vec` ship **prebuilt binaries**. `electron-builder.yml` sets `npmRebuild: false` so packaging does not invoke `node-gyp` (which on Windows often requires **MSVC Spectre-mitigated libraries** from the Visual Studio installer). If you change Electron major versions, run `npx electron-rebuild` locally with a full C++ toolchain before `dist`.

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

## Local smoke (unsigned)

```bash
npm run dist:dir
```

Produces an unpacked app in `release/win-unpacked` (or `release/mac` / `release/linux-unpacked`) without an installer. Updater checks are no-ops in dev (`!app.isPackaged`).
