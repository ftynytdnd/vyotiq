# Security

Vyotiq is a local-first Electron desktop agent. Report security issues responsibly.

## Contact

Email security concerns to the maintainers via your project's configured security contact channel. Do not open public issues for unpatched vulnerabilities.

## Response expectations

- Acknowledge receipt within 3 business days when possible
- Provide a remediation timeline for confirmed issues
- Credit reporters when fixes ship, if they wish

## Desktop security baseline

Vyotiq enforces Electron hardening in production builds:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` on renderer `BrowserWindow`s
- Narrow `contextBridge` surface (`window.vyotiq`) — no raw `ipcRenderer` or Node APIs in the renderer
- IPC payload validation on the main process (`settings:set`, tool/workspace paths, etc.)
- Workspace path sandbox for agent tools (`realpathInsideWorkspace`)

See also [docs/supply-chain-security.md](docs/supply-chain-security.md) for install-time dependency policies (`minimumReleaseAge`, `allowBuilds`, frozen lockfile in CI). Optional `trustPolicy: no-downgrade` is documented there but not enabled until the lockfile is refreshed.

## Scope notes

- User-supplied API keys and GitHub tokens are stored encrypted on disk; treat `%APPDATA%\\vyotiq\\vyotiq\\` as sensitive on shared machines.
- The agent `bash` tool runs in the active workspace with destructive-command guards; users should only open workspaces they trust.
