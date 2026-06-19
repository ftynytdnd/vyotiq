/**
 * Vyotiq — Electron fuse hardening
 *
 * Audit fix 2026-12-P1-1: flip the production-hardening fuses on a packaged
 * Electron binary. Fuses are bytes embedded inside the Electron binary that
 * can be toggled AT BUILD TIME but not at runtime — they are the
 * structurally correct place to disable the half-dozen attack surfaces that
 * Electron exposes by default.
 *
 * Why this is a separate script rather than `postbuild`:
 *
 *   `npm run build` (electron-vite) emits JavaScript only — `out/main`,
 *   `out/preload`, `out/renderer`. There is no packaged `.exe` / `.app` to
 *   flip fuses on at that stage. The bundled Electron binary lives inside
 *   `node_modules/electron/dist/` and is shared across every electron-vite
 *   project on the machine; flipping fuses there would corrupt every other
 *   project's dev binary.
 *
 *   The fuse-flip step belongs in the packaging pipeline (electron-builder
 *   / electron-forge / Squirrel), AFTER the binary has been copied into
 *   the per-app distribution directory and BEFORE code signing. Per the
 *   README's "Out of scope (v1)" note, the packaging pipeline is BYO; this
 *   script is ready to drop into whichever pipeline the integrator wires
 *   up.
 *
 * Usage (after packaging):
 *
 *   node scripts/flipFuses.mjs path/to/packaged/Vyotiq.exe
 *
 * The script is idempotent — re-running it on an already-flipped binary
 * is a no-op (the fuse bytes are already at the desired values).
 *
 * Fuse choices (`@electron/fuses` 2026 line):
 *
 *   - `RunAsNode = false`              — disables the `ELECTRON_RUN_AS_NODE`
 *                                        backdoor that lets a packaged
 *                                        Electron binary run arbitrary
 *                                        Node scripts as a privileged
 *                                        process.
 *   - `EnableCookieEncryption = true`  — encrypts the Chromium cookie
 *                                        database with the OS keychain
 *                                        (we don't use cookies today, but
 *                                        defense-in-depth: any future
 *                                        webview / OAuth flow inherits
 *                                        the protection).
 *   - `EnableNodeOptionsEnvironmentVariable = false`
 *                                      — refuses to honour
 *                                        `NODE_OPTIONS=--inspect=…`,
 *                                        closing the remote-debug-port
 *                                        attack surface that an unprivi-
 *                                        leged user on the same box
 *                                        could otherwise hit.
 *   - `EnableNodeCliInspectArguments = false`
 *                                      — same shape, but for
 *                                        `--inspect` / `--inspect-brk`
 *                                        passed on the cmd line.
 *   - `EnableEmbeddedAsarIntegrityValidation = true`
 *                                      — verifies the bundled `app.asar`
 *                                        hash on launch; tampering with
 *                                        the JS bundle in-place produces
 *                                        a hard launch refusal.
 *   - `OnlyLoadAppFromAsar = true`     — refuses to load the app from a
 *                                        loose directory; the only path
 *                                        is the integrity-checked
 *                                        `app.asar`. Closes the
 *                                        replace-the-folder-on-disk
 *                                        attack vector.
 *   - `LoadBrowserProcessSpecificV8Snapshot = false` — leave default;
 *                                        flipping it on requires a
 *                                        per-process snapshot we don't
 *                                        ship. Listed here so the
 *                                        choice is explicit.
 *   - `GrantFileProtocolExtraPrivileges = false`
 *                                      — keeps the bundled `file://`
 *                                        load (Electron renderer entry
 *                                        point) from picking up extra
 *                                        privileges. Vyotiq does NOT
 *                                        rely on those privileges.
 *
 * The script also fails closed: if `@electron/fuses` is not installed
 * (developer running this without `npm install`), the process exits with
 * code 1 and a pointer to the install command — never silently ships
 * an unhardened binary.
 */

import { argv, exit } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const target = argv[2];
if (!target) {
  console.error('[flipFuses] Usage: node scripts/flipFuses.mjs <path-to-packaged-binary>');
  console.error('[flipFuses] Run AFTER your packaging pipeline (electron-builder / electron-forge)');
  console.error('[flipFuses] has produced the per-platform binary, BEFORE code signing.');
  exit(1);
}

const absTarget = resolve(target);
if (!existsSync(absTarget)) {
  console.error(`[flipFuses] Target binary not found: ${absTarget}`);
  exit(1);
}

let fusesModule;
try {
  fusesModule = await import('@electron/fuses');
} catch (err) {
  console.error('[flipFuses] @electron/fuses is not installed.');
  console.error('[flipFuses] Run `pnpm add -D @electron/fuses` then retry.');
  console.error(`[flipFuses] Underlying error: ${err instanceof Error ? err.message : String(err)}`);
  exit(1);
}

const { flipFuses, FuseVersion, FuseV1Options } = fusesModule;

console.log(`[flipFuses] Hardening: ${absTarget}`);
try {
  await flipFuses(absTarget, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
  });
  console.log('[flipFuses] Done. Re-sign the binary if you signed before this step.');
} catch (err) {
  console.error('[flipFuses] Fuse flip failed:', err instanceof Error ? err.message : err);
  exit(1);
}
