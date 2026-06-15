# Vyotiq · Agent V

A local-first **asynchronous AI orchestrator** that lives on your device. Vyotiq is the company; Agent V is the agent. Vyotiq is built around an unusual idea: the agent's behavior is governed by a **natural-language harness** — markdown files that act as the agent's operating system — not by hardcoded scripts.

## What's different

- **Plain-English harness, not a code-based one.** Agent V reads its rules, loop, memory protocol, and tool catalogue from markdown files in [`src/main/harness/`](src/main/harness/). **Settings → Agent behavior → Harness** lets you override sections at runtime (persisted under userData); bundled defaults still ship in the main process via `harnessLoader.ts`.
- **Single dynamic agent.** Agent V is one agent with a full tool surface (`bash`, `read`, `edit`, `search`, `ls`, `memory`, `recall`, …). It plans, acts directly, and synthesizes answers in one context — no worker or delegation layer.
- **Memory across turns.** Every turn appends typed events to a JSONL transcript. Each new send replays prior events into the OpenAI message shape so the agent remembers earlier user prompts and tool results. Older transcripts are normalized on load when needed.
- **Provider-agnostic, no SDKs.** Vyotiq talks raw OpenAI-compatible HTTP. It works with OpenAI, Anthropic-compat shims, Ollama, LM Studio, vLLM, Groq, Together, or any service that exposes `/v1/models` and `/v1/chat/completions`.
- **Dynamic model discovery.** When you add a provider, Vyotiq calls `GET /v1/models` and populates the model dropdown automatically.
- **DeepSeek thinking-mode aware.** Streamed `reasoning_content` is captured, persisted, and echoed back on the next request. The UI surfaces it as a collapsible "Thoughts" card.
- **Flexible turn endings.** The agent may call `finish` or `ask_user`, or end with substantive prose when that fully answers the user (including short greetings and questions ending in `?`). Empty filler turns get one retry, then a visible error.
- **Structured logging.** All main-process activity flows through a leveled logger with a rotating file at `<userData>/vyotiq/logs/vyotiq.log` (1 MB / 3 backups). Renderer logs relay through the same file via `vyotiq.log`; crashes are caught by an error boundary and forwarded at `error` level.
- **Tailwind v4 CSS-first.** No `tailwind.config.js`. All design tokens live in [`src/renderer/index.css`](src/renderer/index.css) under `@theme` and surface as utilities (`bg-surface-base`, `text-text-muted`, etc.).
- **Private by default.** API keys are encrypted via your OS keychain (Electron `safeStorage`). File operations are sandboxed to your active workspace. No outbound web search — retrieval is local (`search`, `sg`, vector index, workspace memory).

## Orchestrator surfaces

Vyotiq is an orchestrator first, not a full IDE — but selective surfaces support the agent loop:

| Surface | Where | Notes |
|---------|--------|--------|
| **Workspace editor** | Secondary-zone floating panel | CodeMirror 6; open from dock search, `@` mentions, timeline file cards; syncs with agent edits |
| **Shared terminal** | Secondary-zone PTY (`Ctrl+\``) | User + agent share one shell session; agent `bash` can run in the PTY when open |
| **Inline completion** | Editor + composer | Tab/ghost suggestions via a dedicated or chat model (Settings → Agent behavior) |
| **Checkpoints** | Settings + timeline | Accept/reject pending file edits; revert restores on-disk blobs |
| **Harness lab** | Settings → Agent behavior | View/edit harness markdown sections with userData overrides |
| **Transcript export** | Dock chat tab | JSONL or Markdown via native save dialog |
| **Load earlier** | Timeline top | Paginated transcript hydration for long chats |

## Tech stack

- **Electron** (frameless, custom title bar, `contextBridge`, sandboxed renderer)
- **React 19** + **TypeScript 6** + **Vite 8** (via `electron-vite 6`)
- **Tailwind CSS v4** (CSS-first via `@theme`)
- **Zustand** (modular store slices)
- **lucide-react** (icons)
- **fast-glob** + **@ast-grep/napi** + **@ast-grep/cli** (AST search, rewrites, rule scans)
- **sqlite-vec** (local hybrid vector index under `.vyotiq/`)

## Getting started

```bash
npm install
npm run dev
```

This launches Electron with hot-reload for the renderer and a watching build for main + preload.

To produce a production build:

```bash
npm run build
npm run preview
```

To package installers (current OS):

```bash
npm run dist
```

See [`docs/distribution.md`](docs/distribution.md) for code signing, notarization, fuse hardening, and auto-update feed setup.

## First run

1. **Pick a workspace.** Use **File → Open Workspace…** or add a workspace tab in the left navigation dock. This is the folder Agent V's tools (`bash`, `ls`, `read`, `edit`, `search`) will be sandboxed to.
2. **Add a provider.** Open Settings → Providers → "Add provider". Try a preset:
   - **OpenAI:** `https://api.openai.com` + your key
   - **Ollama (local):** `http://localhost:11434` (no key needed)
   - **LM Studio (local):** `http://localhost:1234`
3. **Pick a model.** The composer's model dropdown populates from `/v1/models` automatically.
4. **Send a prompt.** Try: *"Survey this workspace and write a brief project map."*

## Architecture

```
src/
├── main/                          Electron main process
│   ├── harness/                   ← Natural-language operating system (.md files)
│   ├── orchestrator/              AgentV runtime
│   │   ├── AgentV.ts              Lifecycle: start/abort, replay seeding, error wiring
│   │   ├── loop/                  Per-iteration phases (system prompt, assistant turn, tool dispatch)
│   │   ├── replay/                Reconstructs OpenAI messages from the JSONL transcript
│   │   ├── envelope/              XML escape helpers for host envelopes
│   │   ├── contextManager.ts      Workspace + memory envelopes; per-iter refresh
│   │   ├── toolRunner.ts          Tool dispatch (sandbox permissions, no approval modals)
│   │   └── retry.ts               Exponential backoff with abort awareness
│   ├── tools/                     One file per tool
│   │   └── policy/                AGENT_TOOLS allowlist
│   ├── providers/                 Raw HTTP chat client + /v1/models discovery
│   ├── memory/                    Global meta-rules + vector index + hybrid retrieval
│   ├── checkpoints/               Pending edit blobs + accept/reject/rewind
│   ├── conversations/             Persistent JSONL transcript store + index
│   ├── settings/                  Shared settings blob (single writer)
│   ├── secrets/                   safeStorage wrapper
│   ├── logging/                   Centralized leveled + rotating-file logger
│   ├── ipc/                       Typed IPC handlers (one per concern)
│   ├── lsp/                       Optional stdio LSP bridge for the editor
│   ├── terminal/                  Shared PTY (node-pty) for user + agent bash
│   ├── updater/                   electron-updater (packaged builds)
│   ├── window/                    Frameless window factory
│   └── preload/                   contextBridge → window.vyotiq
├── shared/                        Types + constants used by both processes
└── renderer/                      React frontend
    ├── components/                titlebar / composer / timeline / navigation / zone / settings / ui
    │   ├── dock/                  LeftDock (workspace tabs, chat strip, inline search)
    │   ├── workbench/               WorkbenchShell, editor, terminal, globe preview
    │   └── titlebar/menu/         Modular File / Edit menu strip
    ├── store/                     Zustand slices (chat / providers / conversations / settings /
    │                              workspace / ui / checkpoints)
    ├── pages/                     ChatPage + ChatFooter shell
    ├── lib/                       IPC wrapper, logger, helpers
    ├── styles/                    Token documentation
    └── index.css                  @theme tokens (Tailwind v4 CSS-first)
```

## The Natural-Language Harness

The agent's "operating system" lives in [`src/main/harness/`](src/main/harness/) as a set of plain-English markdown files. They are concatenated and wrapped in `<system_instructions>` XML at runtime:

| File | Purpose |
|---|---|
| `00-orchestrator-core.md` | Prime directives and the agent loop (plan, act, verify). |
| `01-context-learning.md` | Context sources, authority order, memory protocol, offline research, continuous learning, and instruction hygiene. |

Per-tool briefs (WHAT/HOW/WHY/WHEN) are pulled directly from each tool's `briefMarkdown` field so they stay in sync with the OpenAI-compat schemas the model sees.

## Tools

Each tool is in its own file (`src/main/tools/<name>.tool.ts`) and registered via `registry.ts`:

- **`bash`** — cross-platform shell (PowerShell on Windows, `/bin/bash` elsewhere). Sandboxed cwd, destructive-pattern detection, timeout. Can share the integrated PTY when open.
- **`ls`** — recursive directory listing. Default-ignores `node_modules`, `.git`, `dist`, `out`, `.next`.
- **`read`** — UTF-8 file reader with line range, 512 KB cap, binary refusal.
- **`edit`** — surgical exact-match edits + file creation. Returns diff stats for the FileChangeCard.
- **`delete`** — remove workspace files (sandboxed).
- **`search`** — ast-grep structural (AST) search across the workspace (`@ast-grep/napi` + CLI fallback).
- **`sg`** — ast-grep CLI for `run` / `scan` / `test` (rewrites and YAML rules).
- **`memory`** — read/write/append global meta-rules or workspace notes.
- **`recall`** — read-only lookup against other conversations in the active workspace.
- **`report`** — HTML deliverables under `.vyotiq/reports/` (Settings → Reports controls UX).

### Tool policy

Agent V's allowlist is `AGENT_TOOLS` in [`src/main/tools/policy/agentTools.ts`](src/main/tools/policy/agentTools.ts): `bash`, `ls`, `read`, `edit`, `delete`, `search`, `sg`, `memory`, `recall`, `report`, `finish`, `ask_user`. The `toolSchemasFor()` helper filters schemas before each model request.

## Transcripts & checkpoints

- Conversations persist as JSONL under `<userData>/vyotiq/conversations/`. The timeline loads the newest slice by default; **Load earlier** paginates backward without hydrating the full file into memory.
- **Export** from the dock chat tab (Markdown or JSONL) via a native save dialog.
- **Checkpoints** (Settings → Agent behavior) let you accept or reject pending file edits; **Revert** on a user prompt restores on-disk files and trims the transcript.

## Memory

- **Global meta-rules** live in `<userData>/vyotiq/meta-rules.md`. Loaded into `<meta_rules>` on every boot.
- **Workspace notes** live in `<workspace>/.vyotiq/memory/*.md`.
- **Vector index** (`<workspace>/.vyotiq/vector/index.db`) embeds notes + source files for hybrid keyword + vector retrieval (`recall`, `memory`, orchestrator context).

## Security

- API keys are encrypted via Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux). Never written in plaintext.
- All tool paths funnel through `src/main/tools/sandbox.ts`. Path-escape attempts throw before reaching the filesystem.
- A regex list of catastrophic patterns (`rm -rf /`, `format c:`, `git reset --hard`, fork bombs, `shutdown`, `mkfs`, `dd of=/dev/`, write-redirection to absolute paths, `tee` to absolute paths, recursive `chmod` rooted at `/`) is checked in `src/main/tools/sandbox.ts` before `bash` runs; matches return a `destructive blocked` tool result (no confirmation modal).
- The Chromium renderer runs in the OS sandbox (`webPreferences.sandbox: true`) with `contextIsolation`, `nodeIntegration: false`, and `will-navigate` / `will-attach-webview` guards. The CSP pins `script-src 'self'`, blocks `object-src`, `frame-ancestors`, `form-action`, and forbids `<base>` rewriting.
- Production binaries are hardened with `@electron/fuses` via the packaging pipeline (`scripts/afterPackFlipFuses.cjs` runs automatically before signing). Manual hardening: `npm run flip-fuses -- path/to/Vyotiq.exe`.

## Distribution & updates

- **Package:** `npm run dist` (electron-builder → `release/`). Platform targets: `dist:win`, `dist:mac`, `dist:linux`.
- **Signing / notarization:** env-driven — see [`docs/distribution.md`](docs/distribution.md).
- **Auto-update:** packaged builds use `electron-updater` with `autoDownload: true`. Set `UPDATE_BASE_URL` (build + runtime) and run `npm run dist:publish`. For unsigned smoke tests set `VYOTIQ_ALLOW_UNSIGNED_UPDATES=1`. Users get a toast when an update is ready; **Settings → About → Install & restart**.

## Out of scope (v1)

- **Voice mic** — no transcription engine bundled.
- **Outbound web search** — local retrieval only (privacy-first).
- **MCP / sub-agents / approval gates** — solo Agent V with immediate tool apply.

## License

Private prototype. No license granted.
