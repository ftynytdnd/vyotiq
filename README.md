# Vyotiq · Agent V

A local-first **asynchronous AI orchestrator** that lives on your device. Vyotiq is the company; Agent V is the agent. Vyotiq is built around an unusual idea: the agent's behavior is governed by a **natural-language harness** — markdown files that act as the agent's operating system — not by hardcoded scripts.

## What's different

- **Plain-English harness, not a code-based one.** Agent V reads its rules, loop, delegation strategy, memory protocol, and tool catalogue from markdown files in [`src/main/harness/`](src/main/harness/). You can read them, change them, and the agent's behavior changes accordingly. **Note:** the harness is bundled into the **main process** at build time via `harnessLoader.ts` (Vite `?raw` imports), not the renderer — editing the `.md` files in a packaged build has no effect until the next rebuild. In a dev build (`npm run dev`) Vite's HMR picks up edits live.
- **Real parallel sub-agents.** When Agent V decomposes a task, each sub-task is spawned as a genuine, isolated `fetch()` call to the model with a fresh context window. Sub-agents never see each other's history. In the UI they render inline in the conversation timeline under `src/renderer/components/timeline/delegation/` (`DelegationStream`, worker outlines) — no separate sub-agents panel.
- **Strict toolset partition.** The orchestrator's direct catalogue is `ls`, `memory`, and `recall` plus the forced-action tools `delegate`, `finish`, and `ask_user`. Heavy work (`bash`, `edit`, `search`, `read`) is architecturally forced through `delegate` tool calls. The host enforces this by filtering schemas before each request and requiring a tool call every turn (`tool_choice: 'required'` on capable providers).
- **Memory across turns.** Every turn appends typed events to a JSONL transcript. Each new send replays prior events into the OpenAI message shape so the agent remembers earlier user prompts, tool calls, and verified sub-agent results. (Sub-agent internals stay isolated; only the verified envelope is replayed.)
- **Provider-agnostic, no SDKs.** Vyotiq talks raw OpenAI-compatible HTTP. It works with OpenAI, Anthropic-compat shims, Ollama, LM Studio, vLLM, Groq, Together, or any service that exposes `/v1/models` and `/v1/chat/completions`.
- **Dynamic model discovery.** When you add a provider, Vyotiq calls `GET /v1/models` and populates the model dropdown automatically.
- **DeepSeek thinking-mode aware.** Streamed `reasoning_content` is captured, persisted, and echoed back on the next request. The UI surfaces it as a collapsible "Thoughts" card.
- **Forced-action loop.** Every orchestrator turn must call a tool (`tool_choice: 'required'` on capable providers). Empty turns get one retry, then a visible error — no silent stops and no host-side planning nudges.
- **Three-strike sub-agent halt.** If three consecutive delegation rounds end with every sub-agent failing verification, the host halts the run and surfaces an error rather than burning more cycles.
- **Structured logging.** All main-process activity flows through a leveled logger with a rotating file at `<userData>/vyotiq/logs/vyotiq.log` (1 MB / 3 backups). Renderer logs relay through the same file via `vyotiq.log`; crashes are caught by an error boundary and forwarded at `error` level.
- **Tailwind v4 CSS-first.** No `tailwind.config.js`. All design tokens live in [`src/renderer/index.css`](src/renderer/index.css) under `@theme` and surface as utilities (`bg-surface-base`, `text-text-muted`, etc.).
- **Private by default.** API keys are encrypted via your OS keychain (Electron `safeStorage`). Web search is off by default and refuses non-HTTPS endpoints (except localhost). File operations are sandboxed to your active workspace.

## Tech stack

- **Electron** (frameless, custom title bar, `contextBridge`, sandboxed renderer)
- **React 19** + **TypeScript 6** + **Vite 7** (via `electron-vite 5`)
- **Tailwind CSS v4** (CSS-first via `@theme`)
- **Zustand** (modular store slices)
- **lucide-react** (icons)
- **fast-glob** (local search + workspace listing)

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
│   │   ├── loop/                  Per-iteration phases (system prompt, assistant turn,
│   │   │                         tool dispatch, delegates, degradation, synthesis)
│   │   ├── replay/                Reconstructs OpenAI messages from the JSONL transcript
│   │   ├── envelope/              <subagent_results>, XML escape, summary
│   │   ├── SubAgent.ts            Single sub-agent runtime (own fetch, isolated context)
│   │   ├── SubAgentPool.ts        Bounded parallel pool with telemetry callbacks
│   │   ├── verifier.ts            Validates each sub-agent's <result> envelope
│   │   ├── contextManager.ts      Workspace + memory envelopes; per-iter refresh
│   │   ├── toolRunner.ts          Tool dispatch (sandbox permissions, no approval modals)
│   │   └── retry.ts               Exponential backoff with abort awareness
│   ├── tools/                     One file per tool, plus the orchestrator/sub-agent
│   │   └── policy/                allowlists (bash/ls/read/edit/search/memory)
│   ├── providers/                 Raw HTTP chat client + /v1/models discovery
│   ├── conversations/             Persistent JSONL transcript store + index
│   ├── memory/                    Global meta-rules + per-workspace notes
│   ├── settings/                  Shared settings blob (single writer)
│   ├── secrets/                   safeStorage wrapper
│   ├── logging/                   Centralized leveled + rotating-file logger
│   ├── ipc/                       Typed IPC handlers (one per concern)
│   ├── window/                    Frameless window factory
│   └── preload/                   contextBridge → window.vyotiq
├── shared/                        Types + constants used by both processes
└── renderer/                      React frontend
    ├── components/                titlebar / composer / timeline / navigation / zone / settings / ui
    │   ├── dock/                  LeftDock (workspace tabs, chat strip, inline search)
    │   ├── timeline/delegation/   Inline delegation workers and mini-threads in the conversation timeline
    │   ├── zone/                  SecondaryZone + PanelFrame (settings)
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
| `00-orchestrator-core.md` | Prime directives (inviolable rules) plus the orchestration loop, delegation rules, and three-strike self-correction protocol. |
| `01-context-learning.md` | Context sources, authority order, memory protocol, offline research, continuous learning, and instruction hygiene. |
| `02-subagent-prompt.md` | Minimal harness given to ephemeral sub-agents (assembled with granted tool briefs at runtime). |

Per-tool briefs (WHAT/HOW/WHY/WHEN) are pulled directly from each tool's `briefMarkdown` field so they stay in sync with the OpenAI-compat schemas the model sees.

## Tools

Each tool is in its own file (`src/main/tools/<name>.tool.ts`) and registered via `registry.ts`:

- **`bash`** — cross-platform shell (PowerShell on Windows, `/bin/bash` elsewhere). Sandboxed cwd, destructive-pattern detection, timeout.
- **`ls`** — recursive directory listing. Default-ignores `node_modules`, `.git`, `dist`, `out`, `.next`.
- **`read`** — UTF-8 file reader with line range, 512 KB cap, binary refusal.
- **`edit`** — surgical exact-match edits + file creation. Returns diff stats for the FileEditCard.
- **`search`** — local grep across the workspace.
- **`memory`** — read/write/append global meta-rules or workspace notes.
- **`recall`** — read-only lookup against other conversations in the active workspace (orchestrator-only).

### Toolset partition

The orchestrator and sub-agents see different tool catalogues, declared in [`src/main/tools/policy/`](src/main/tools/policy/):

- **Orchestrator** — `ls`, `memory`, `recall`, `delegate`, `finish`, `ask_user`. Recon, meta-rule curation, cross-conversation recall, delegation, run termination, and user clarification. File reads and mutations route through sub-agents spawned via `delegate`.
- **Sub-agent (default)** — `read`, `ls`, `search`. Read-only by default.
- **Sub-agent (full)** — `bash`, `ls`, `read`, `edit`, `search`. Opt-in via the `tools` argument on a `delegate` call.

The `toolSchemasFor()` helper in `registry.ts` filters the schemas before each model request, so a forbidden tool is never even exposed to the wire.

## Memory

- **Global meta-rules** live in `<userData>/vyotiq/meta-rules.md`. Loaded into `<meta_rules>` on every boot.
- **Workspace notes** live in `<workspace>/.vyotiq/memory/*.md`. Top-N relevant notes are injected into `<recent_memory>` at the start of each turn via keyword retrieval.

## Security

- API keys are encrypted via Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux). Never written in plaintext.
- All tool paths funnel through `src/main/tools/sandbox.ts`. Path-escape attempts throw before reaching the filesystem.
- A regex list of catastrophic patterns (`rm -rf /`, `format c:`, `git reset --hard`, fork bombs, `shutdown`, `mkfs`, `dd of=/dev/`, write-redirection to absolute paths, `tee` to absolute paths, recursive `chmod` rooted at `/`) is checked in `src/main/tools/sandbox.ts` before `bash` runs; matches return a `destructive blocked` tool result (no confirmation modal).
- Web search sends only the user's query string. Never file contents, paths, or environment variables. Response bodies are stream-read with a 1 MB hard cap to prevent hostile / mis-configured endpoints from exhausting memory.
- The Chromium renderer runs in the OS sandbox (`webPreferences.sandbox: true`) with `contextIsolation`, `nodeIntegration: false`, and `will-navigate` / `will-attach-webview` guards. The CSP pins `script-src 'self'`, blocks `object-src`, `frame-ancestors`, `form-action`, and forbids `<base>` rewriting.
- Production binaries should be hardened with `@electron/fuses` via the bundled script: after your packaging pipeline produces the binary, run `npm run flip-fuses -- path/to/Vyotiq.exe` to disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and the V8 inspector args; enable ASAR integrity validation; and require the app to load only from the integrity-checked archive.

## Out of scope (v1)

- **Voice mic** — no transcription engine bundled.
- **Vector DB / semantic memory** — keyword retrieval is sufficient for v1; documented as a swap point.
- **Auto-update / code-signing pipeline** — bring your own.

## License

Private prototype. No license granted.