# Vyotiq · Agent V

A local-first **asynchronous AI orchestrator** that lives on your device. Vyotiq is the company; Agent V is the agent. Vyotiq is built around an unusual idea: the agent's behavior is governed by a **natural-language harness** — markdown files that act as the agent's operating system — not by hardcoded scripts.

## What's different

- **Plain-English harness, not a code-based one.** Agent V reads its rules, loop, delegation strategy, memory protocol, and tool catalogue from markdown files in [`src/main/harness/`](src/main/harness/). You can read them, change them, and the agent's behavior changes accordingly.
- **Real parallel sub-agents.** When Agent V decomposes a task, each sub-task is spawned as a genuine, isolated `fetch()` call to the model with a fresh context window. Sub-agents never see each other's history.
- **Strict toolset partition.** The orchestrator can only call `ls`, `read`, and `memory` directly — heavy work (`bash`, `edit`, `search`) is architecturally forced through `<delegate />` directives. The host enforces this by filtering schemas before each request.
- **Memory across turns.** Every turn appends typed events to a JSONL transcript. Each new send replays prior events into the OpenAI message shape so the agent remembers earlier user prompts, tool calls, and verified sub-agent results. (Sub-agent internals stay isolated; only the verified envelope is replayed.)
- **Provider-agnostic, no SDKs.** Vyotiq talks raw OpenAI-compatible HTTP. It works with OpenAI, Anthropic-compat shims, Ollama, LM Studio, vLLM, Groq, Together, or any service that exposes `/v1/models` and `/v1/chat/completions`.
- **Dynamic model discovery.** When you add a provider, Vyotiq calls `GET /v1/models` and populates the model dropdown automatically.
- **DeepSeek thinking-mode aware.** Streamed `reasoning_content` is captured, persisted, and echoed back on the next request. The UI surfaces it as a collapsible "Thoughts" card.
- **Auto-nudge on premature stop.** If the model emits a planning turn but never takes action, the host injects a short nudge and re-iterates (capped at 2/run) instead of terminating silently.
- **Three-strike sub-agent halt.** If three consecutive delegation rounds end with every sub-agent failing verification, the host halts the run and surfaces an error rather than burning more cycles.
- **Structured logging.** All main-process activity flows through a leveled logger with a rotating file at `<userData>/vyotiq/logs/vyotiq.log` (1 MB / 3 backups). Renderer crashes are caught by an error boundary and forwarded to the same log.
- **Tailwind v4 CSS-first.** No `tailwind.config.js`. All design tokens live in [`src/renderer/index.css`](src/renderer/index.css) under `@theme` and surface as utilities (`bg-surface-base`, `text-text-muted`, etc.).
- **Private by default.** API keys are encrypted via your OS keychain (Electron `safeStorage`). Web search is off by default and refuses non-HTTPS endpoints (except localhost). File operations are sandboxed to your active workspace.

## Tech stack

- **Electron** (frameless, custom title bar, `contextBridge`)
- **React 18** + **TypeScript** + **Vite** (`electron-vite`)
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

1. **Pick a workspace.** Click "Open workspace…" in the bottom of the sidebar. This is the folder Agent V's tools (`bash`, `ls`, `read`, `edit`, `search`) will be sandboxed to.
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
│   │   │                         tool calls, delegates, no-tool nudge, master loop)
│   │   ├── replay/                Reconstructs OpenAI messages from the JSONL transcript
│   │   ├── envelope/              <delegate>, <subagent_results>, XML escape, summary
│   │   ├── heuristics/            isPlanningWithoutAction predicate
│   │   ├── SubAgent.ts            Single sub-agent runtime (own fetch, isolated context)
│   │   ├── SubAgentPool.ts        Bounded parallel pool with telemetry callbacks
│   │   ├── verifier.ts            Validates each sub-agent's <result> envelope
│   │   ├── contextManager.ts      Workspace + memory envelopes; per-iter refresh; prune
│   │   ├── toolRunner.ts          Tool dispatch with permissions + confirm flow
│   │   ├── confirmBus.ts          Renderer ↔ main confirmation round-trip
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
    ├── components/                titlebar / sidebar / composer / timeline / settings / ui / confirm
    │   └── titlebar/menu/         Modular File / Edit / View menu strip
    ├── store/                     Zustand slices (chat / agents / providers / conversations
    │                              / settings / workspace / ui)
    ├── pages/                     ChatPage
    ├── lib/                       IPC wrapper + small helpers
    ├── styles/                    Token documentation
    └── index.css                  @theme tokens (Tailwind v4 CSS-first)
```

## The Natural-Language Harness

The agent's "operating system" lives in [`src/main/harness/`](src/main/harness/) as a set of plain-English markdown files. They are concatenated and wrapped in `<system_instructions>` XML at runtime:

| File | Purpose |
|---|---|
| `00-prime-directives.md` | Inviolable rules (privacy, containment, destructive actions, honesty, tool discipline, security bounds). |
| `01-orchestration-loop.md` | The orchestration loop plus delegation rules and the three-strike self-correction protocol. |
| `02-context-and-memory.md` | Context sources, authority order, memory protocol (global meta-rules vs. workspace notes), and research modes. |
| `03-continuous-learning.md` | When and how to persist user corrections to global meta-rules. |
| `04-subagent-prompt.md` | Minimal harness given to ephemeral workers. |

Per-tool briefs (WHAT/HOW/WHY/WHEN) are pulled directly from each tool's `briefMarkdown` field so they stay in sync with the OpenAI-compat schemas the model sees.

## Tools

Each tool is in its own file (`src/main/tools/<name>.tool.ts`) and registered via `registry.ts`:

- **`bash`** — cross-platform shell (PowerShell on Windows, `/bin/bash` elsewhere). Sandboxed cwd, destructive-pattern detection, timeout.
- **`ls`** — recursive directory listing. Default-ignores `node_modules`, `.git`, `dist`, `out`, `.next`.
- **`read`** — UTF-8 file reader with line range, 512 KB cap, binary refusal.
- **`edit`** — surgical exact-match edits + file creation. Returns diff stats for the FileEditCard.
- **`search`** — local grep (default) or web search (when `allowWebSearch` is on; HTTPS-only).
- **`memory`** — read/write/append global meta-rules or workspace notes.

### Toolset partition

The orchestrator and sub-agents see different tool catalogues, declared in [`src/main/tools/policy/`](src/main/tools/policy/):

- **Orchestrator** — `ls`, `read`, `memory`. Recon and meta-rule curation only.
- **Sub-agent (default)** — `read`, `ls`, `search`. Read-only by default.
- **Sub-agent (full)** — `bash`, `ls`, `read`, `edit`, `search`. Opt-in via `tools=` on a `<delegate />`.

The `toolSchemasFor()` helper in `registry.ts` filters the schemas before each model request, so a forbidden tool is never even exposed to the wire.

## Memory

- **Global meta-rules** live in `<userData>/vyotiq/meta-rules.md`. Loaded into `<meta_rules>` on every boot.
- **Workspace notes** live in `<workspace>/.vyotiq/memory/*.md`. Top-N relevant notes are injected into `<recent_memory>` at the start of each turn via keyword retrieval.

## Security

- API keys are encrypted via Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux). Never written in plaintext.
- All tool paths funnel through `src/main/tools/sandbox.ts`. Path-escape attempts throw before reaching the filesystem.
- A regex list of catastrophic patterns (`rm -rf /`, `format c:`, `git reset --hard`, fork bombs, `shutdown`, `mkfs`, `dd of=/dev/`) intercepts `bash` calls and forces an explicit user confirmation through the in-app `ConfirmHost` modal.
- Web search sends only the user's query string. Never file contents, paths, or environment variables.

## Out of scope (v1)

- **Voice mic** — no transcription engine bundled.
- **Vector DB / semantic memory** — keyword retrieval is sufficient for v1; documented as a swap point.
- **Auto-update / code-signing pipeline** — bring your own.

## License

Private prototype. No license granted.