# Supply chain security

Vyotiq uses **pnpm 11** with layered defenses against supply-chain attacks. This document covers project-enforced settings (committed to the repo) and optional developer-machine hardening.

**Requirements:** Node.js ≥ 22 and pnpm ≥ 11 (`engines` and `packageManager` in `package.json`). Enable via Corepack (`corepack enable`) or install pnpm globally.

## Install dependencies

```bash
pnpm run install:hardened
```

This runs `pnpm install --frozen-lockfile` — installs exactly what is in `pnpm-lock.yaml` and verifies supply-chain policies before fetching tarballs.

For local development when `package.json` changes, use:

```bash
pnpm install
```

Then commit the updated `pnpm-lock.yaml`. CI and release builds use the frozen install (see `.github/workflows/ci.yml` and `release.yml`).

## Layer 1 — Package cooldown (age-gating)

[`pnpm-workspace.yaml`](../pnpm-workspace.yaml) sets `minimumReleaseAge: 10080` (minutes = 7 days). pnpm will not resolve package versions published within the last seven days. The lockfile is re-verified on every install.

**Optional (not yet enabled):** `trustPolicy: no-downgrade` blocks versions with weaker provenance than prior releases. Enabling it requires refreshing the lockfile (`pnpm install`) and may need `trustPolicyExclude` for legacy transitive packages — see [pnpm trustPolicy](https://pnpm.io/settings#trustpolicy).

**Emergency override:** add a package to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` when you deliberately need a version that has not matured yet.

**Bypass warning:** `pnpm dlx` and `npx` can fetch the latest versions and skip age-gating. Prefer committed devDependencies and `pnpm exec --no-install <command>`.

## Layer 2 — Post-install script allowlist

pnpm disables dependency lifecycle scripts by default (`strictDepBuilds`). Only packages listed in `allowBuilds` with `true` run install hooks.

Current allowed builds: `@ast-grep/cli`, `electron`, `esbuild`, `electron-winstaller`, `node-pty`, `fsevents` (macOS optional).

After adding or upgrading a dependency with install scripts:

```bash
pnpm approve-builds <package-name>
```

Review the updated `allowBuilds` map in `pnpm-workspace.yaml`, set required packages to `true`, then reinstall.

## Layer 3 — Block git-based dependencies

`blockExoticSubdeps: true` in `pnpm-workspace.yaml` blocks transitive git URL and tarball dependencies. Only registry packages are permitted for subdependencies.

## Layer 4 — Install-time firewall (optional, local)

These tools scan packages **before** install. Configure on your machine — they are not enforced by the repo.

### npq (recommended)

No account required.

```powershell
# PowerShell profile — intercept pnpm installs
function pnpm { npq @args }
```

Install globally: `pnpm add -g npq` (or `npm install -g npq`).

### Socket CLI (alternative)

Broader ecosystem support (npm, pip, cargo). See [socket.dev](https://socket.dev).

After setting up either tool, clear the package-manager cache once:

```bash
pnpm store prune
```

## Layer 5 — Lockfile integrity

pnpm lockfiles use a content-addressable format that is not vulnerable to the npm `resolved` URL tampering attack. Every install re-verifies lockfile entries against `minimumReleaseAge`, `blockExoticSubdeps`, and `allowBuilds` policies.

Always commit `pnpm-lock.yaml` with dependency changes.

## Layer 6 — Frozen CI installs

- **Local / CI:** `pnpm install --frozen-lockfile` (via `pnpm run install:hardened`).
- **Never** use bare `pnpm install` in deployment pipelines without committing the resulting lockfile.

## Layer 7 — Hardened habits

- **Pin exact versions.** All dependencies in `package.json` use exact versions (no `^` ranges). `.npmrc` sets `save-exact=true` for new adds.
- **No blanket updates.** Avoid `pnpm update` without review; upgrade dependencies deliberately in focused PRs.
- **Minimize dependencies.** Prefer native APIs and small local helpers over new packages. Use `pnpm run knip` to find unused deps.
- **Review lockfile PRs.** Inspect `pnpm-lock.yaml` diffs for unexpected packages or version jumps.
- **Scan before adding.** Run new packages through npq or Socket locally before merging.

## Electron packaging note

[`.npmrc`](../.npmrc) sets `node-linker=hoisted` so `electron-builder` can resolve native modules at `node_modules/<pkg>` paths listed in `electron-builder.yml` `asarUnpack`.

## Quick reference

| Check | Command |
|-------|---------|
| Install (CI/dev) | `pnpm run install:hardened` |
| Approve build scripts | `pnpm approve-builds <pkg>` |
| pnpm version | `pnpm --version` (need ≥ 11) |
