# Vyotiq

**Vyotiq is a local-first, private AI desktop application.** The company is named Vyotiq, and the AI assistant that lives inside the app is called **Agent V**.

Agent V is a single, self-governing AI agent that runs on your own computer. It can read and write files, run terminal commands, search your code, take notes, and answer questions — all inside whatever project folder (workspace) you point it at. Your files, your API keys, and your conversations stay on your machine. Nothing is sent anywhere except to the AI model provider you explicitly choose to use.

The defining idea behind Vyotiq is that the agent's "brain" — how it plans, when it uses tools, how it manages its own memory and context — is written in **plain, structured English** instead of hardcoded program logic. These English instructions are called the *harness*, and you can read them like a rulebook.

---

## Table of Contents

- [What Makes Vyotiq Different](#what-makes-vyotiq-different)
- [Key Features](#key-features)
- [How It Works (High Level)](#how-it-works-high-level)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Available Commands](#available-commands)
- [Connecting an AI Provider](#connecting-an-ai-provider)
- [Project Structure](#project-structure)
- [Agent V's Tools](#agent-vs-tools)
- [The Natural-Language Harness](#the-natural-language-harness)
- [Context & Memory Management](#context--memory-management)
- [Privacy & Safety](#privacy--safety)
- [Where Your Data Lives](#where-your-data-lives)
- [Documentation](#documentation)
- [License](#license)

---

## What Makes Vyotiq Different

Most AI agent tools wire their decision-making into code: scripts decide when to call a tool, how to summarize history, and how to recover from errors. Vyotiq takes a different path.

- **The agent is governed by English, not code.** Agent V's behavior is defined by a set of Markdown "harness" files written as clear rules in plain language. You can open them, read them, and understand exactly how the agent is meant to think.
- **One agent, full access.** There are no sub-agents, workers, or delegation layers. Agent V is a single agent that plans, runs tools directly in your workspace, and writes the final answer — all in one continuous train of thought.
- **It stays on your device.** Vyotiq is built to be a private assistant. It never sends your file contents, secrets, or environment variables anywhere on its own, and it does not browse the web by default.
- **It works with any AI provider.** Instead of being locked to one company's software kit, Vyotiq talks to AI providers using plain web requests and automatically discovers which models each provider offers.

---

## Key Features

- **Multiple concurrent chats** — run separate conversations, even across different project folders, each with its own Agent V run.
- **Direct workspace tools** — Agent V can run shell commands, list directories, read and edit files, delete files, and perform structural code search.
- **Dynamic model discovery** — add a provider once and Vyotiq fetches its full, current model list for you. No model IDs are hardcoded.
- **Smart context management** — the app keeps the conversation within the model's real context window and shrinks it gracefully before quality degrades, all while keeping the original goal and progress visible.
- **Local memory & continuous learning** — Agent V can write notes about your preferences and project, and update a persistent "meta-rules" file so it doesn't repeat mistakes.
- **Built-in workbench** — a code editor, terminal, and preview pane sit beside the chat, so you can watch and work alongside the agent.
- **Screen capture & vision** — attach screenshots (display, a window, or the Vyotiq window itself) to a message; capture is always something *you* start, never automatic.
- **HTML run reports** — generate a readable summary of what the agent did during a run (a free quick summary, or a richer AI-written one).
- **Polished, stealth-dark UI** — the "Shell Mono" design system: a calm, frameless, chromeless interface tuned for long reading and focus.

---

## How It Works (High Level)

Vyotiq is an Electron desktop app, which means it has two cooperating halves:

1. **The Main process** is the "backend." It holds the orchestration loop that drives Agent V, runs the tools, talks to AI providers over the network, stores conversations and memory, and manages windows. It is the only part allowed to see your decrypted API keys.
2. **The Renderer process** is the "frontend" — the React user interface you see and click. It shows the chat timeline, the composer where you type, the settings, and the workbench (editor/terminal/preview).

The two halves talk to each other through a secure, well-defined message channel (IPC). When you send a message, the Main process starts a run: Agent V reads its English harness, plans, calls tools as needed, evaluates each result, and streams its thinking and answer back to the Renderer in real time.

---

## Technology Stack

Vyotiq is built on modern (2026) standards with a focus on performance and modularity.

| Area | Choice |
| --- | --- |
| Desktop shell | **Electron** (strict Main / Renderer separation, secure context-bridge IPC) |
| Frontend | **React 19 + TypeScript**, bundled with **Vite 8** via **electron-vite 6** |
| State management | **Zustand** (lightweight, modular global state) |
| Styling | **Tailwind CSS v4**, CSS-first — design tokens are native CSS variables in `src/renderer/index.css` using `@theme`, with **no `tailwind.config.js`** |
| Editor | **CodeMirror 6** (with an optional language-server bridge for Pyright and TypeScript) |
| Terminal | **xterm.js** backed by **node-pty** |
| Code search | **ast-grep** for structural, syntax-aware search and rewrites |
| AI access | **Raw HTTP only** — no vendor SDKs |
| Package manager | **pnpm 11** (hardened, supply-chain-aware install) |
| Testing | **Vitest** for unit tests, **Playwright** for end-to-end tests |

The primary development OS is **Windows (PowerShell)**, though the app builds for Windows, macOS, and Linux.

---

## Getting Started

### Prerequisites

- **Node.js 22 or newer**
- **pnpm 11 or newer**

### Install

Clone the repository, then install dependencies. For a reproducible, supply-chain-safe install, use the frozen lockfile:

```bash
pnpm install --frozen-lockfile
```

(During day-to-day development a plain `pnpm install` also works.)

### Run in Development

```bash
pnpm dev
```

This starts the app with hot reloading for the renderer and live rebuilds for the main process.

### Build a Production Bundle

```bash
pnpm build      # compile main, preload, and renderer into ./out
pnpm start      # preview the production build
```

### Package an Installable App

```bash
pnpm dist        # build and package for the current platform
pnpm dist:win    # Windows
pnpm dist:mac    # macOS
pnpm dist:linux  # Linux
```

---

## Available Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app in development mode with hot reload |
| `pnpm build` | Build main, preload, and renderer bundles into `out/` |
| `pnpm start` | Preview the built production app |
| `pnpm typecheck` | Type-check both the Node (main) and web (renderer) projects |
| `pnpm test` | Run the unit test suite once (Vitest) |
| `pnpm test:watch` | Run unit tests in watch mode |
| `pnpm test:coverage` | Run unit tests with a coverage report |
| `pnpm test:e2e` | Run end-to-end tests (Playwright) |
| `pnpm knip` | Find unused files, exports, and dependencies |
| `pnpm dist` | Build and package an installer for the current platform |

---

## Connecting an AI Provider

Vyotiq is not tied to any single AI company. You add providers yourself in **Settings**, and the app discovers their models automatically.

To add a provider you supply:

- a **Base URL** (the provider's API endpoint),
- an **API key**, and
- a **dialect** that tells Vyotiq how to speak to that provider.

Supported dialects today are:

- **OpenAI-compatible** — works with OpenAI itself and the many local and cloud servers that mimic its API (LM Studio, vLLM, OpenRouter, DeepSeek, xAI, and more).
- **Anthropic** (native)
- **Gemini** (native)
- **Ollama** (native)

Once a provider is added, Vyotiq calls its model-listing endpoint (the standard `GET /v1/models` for OpenAI-style providers) and fills the model picker with everything that provider currently offers — including each model's context window, pricing, and whether it supports "thinking"/reasoning. Because nothing is hardcoded, any newly released model or any model you download locally shows up automatically.

Your API keys are encrypted at rest on your own machine, and only the part of the app that actually makes the network request is ever allowed to read them.

---

## Project Structure

The codebase is organized into three top-level areas under `src/`, plus tests and docs. Every feature is kept in small, focused, modular files and folders.

```
vyotiq/
├─ src/
│  ├─ main/          # Electron main process (the "backend")
│  │  ├─ orchestrator/   # The Agent V run loop, context handling, replay
│  │  ├─ harness/        # Plain-English rule files that govern Agent V
│  │  ├─ tools/          # One file per tool (bash, read, edit, search, …)
│  │  ├─ providers/      # AI provider HTTP clients & model discovery
│  │  ├─ ipc/            # Secure channels exposed to the renderer
│  │  ├─ conversations/  # Persistence of chats and transcripts
│  │  ├─ memory/         # Local note-taking & vector retrieval
│  │  ├─ capture/        # Screen capture framebuffer bridge
│  │  ├─ scheduler/      # Scheduled / queued runs
│  │  ├─ followUps/      # Steering & queued follow-up messages
│  │  ├─ checkpoints/    # File-change checkpoints & blob store
│  │  ├─ terminal/       # PTY management for the agent's shell
│  │  ├─ lsp/            # Optional language-server bridge for the editor
│  │  └─ settings/, secrets/, window/, updater/, …
│  │
│  ├─ renderer/      # React UI (the "frontend")
│  │  ├─ components/     # Timeline, composer, dock, workbench, settings, …
│  │  ├─ pages/          # Top-level views (e.g. ChatPage)
│  │  ├─ store/          # Zustand stores & the chat event channel
│  │  ├─ hooks/, lib/    # Shared UI hooks and helpers
│  │  ├─ styles/         # Shell Mono CSS
│  │  └─ index.css       # Tailwind v4 @theme design tokens
│  │
│  └─ shared/        # Code & types used by both processes
│     ├─ types/         # Shared TypeScript types (chat, ipc, capture, …)
│     ├─ providers/     # Provider helpers shared across processes
│     ├─ transcript/    # Transcript export & legacy normalization
│     ├─ text/, token/, context/, keybindings/, settings/, …
│
├─ tests/            # Vitest unit tests + Playwright e2e tests
├─ docs/             # Design and audit documents
├─ project.md        # Authoritative product/architecture spec
├─ AGENTS.md         # Learned preferences & workspace facts for the agent
├─ electron.vite.config.ts
├─ electron-builder.yml
└─ package.json
```

---

## Agent V's Tools

Each tool lives in its own file under `src/main/tools/`, and which tools are available is controlled by an allowlist in `src/main/tools/policy/`. The core tools are:

| Tool | What it lets the agent do |
| --- | --- |
| `bash` | Run shell commands inside the workspace (with long-running output capture) |
| `ls` | List files and directories |
| `read` | Read file contents, preserving original encoding and line endings |
| `edit` | Make surgical edits to files without disturbing the surrounding code |
| `delete` | Remove files |
| `search` | Structural, syntax-aware code search using ast-grep patterns |
| `sg` | Run ast-grep scans and rewrites |
| `memory` | Write and append local notes (preferences, project facts, recurring bugs) |
| `recall` | Look up previously stored notes before answering |
| `report` | Generate an HTML summary of what a run accomplished |
| `capture` | Pull a screen frame through the same bridge the composer uses |
| `ask_user` | Pause and ask you a clarifying question instead of guessing |
| `finish` | Cleanly conclude a run |

Each tool is described to the agent in plain English — what it is, how to use it, why it exists, and when to choose it over another tool.

---

## The Natural-Language Harness

The harness is the heart of Vyotiq. It is a set of Markdown files in `src/main/harness/` that are injected into the AI model as its operating instructions every turn:

- `00-orchestrator-core.md` — the core rules: how to understand a request, plan silently, execute tools, evaluate results, and verify before answering.
- `01-context-learning.md` — how Agent V learns from you and keeps its memory up to date.
- `02-deliverables.md` — what good, complete output looks like.
- `03-static-examples.md` — stable worked examples that also help the AI provider cache the prompt efficiently.
- `04-ast-grep-cheatsheet.md` — practical guidance for structural search and rewrites.

To keep the model focused and safe from prompt injection, the harness and the live environment are kept apart using XML-style boundaries: the rules sit in clearly marked instruction blocks, while dynamic data (your workspace context, recent memory, the current turn) is wrapped in its own tags that the agent treats strictly as information, never as commands.

The loop is also resilient. If a tool fails, the error is caught, explained, and fed back to the agent so it can analyze what went wrong and try a corrected approach — using retry logic with exponential backoff. Only after repeated failed self-corrections does Agent V stop and ask you for help.

---

## Context & Memory Management

**Context management is on by default.** As a conversation grows, Vyotiq watches how full the model's context window is and reduces the prompt *before* quality starts to drop. The composer shows a live, color-coded meter of how full the window is, measured against the model's real window size.

When the conversation gets large, reduction happens in gentle, reversible-first stages:

1. **Offload old tool results** to restorable on-disk banners (the agent can read them back if needed).
2. **Offload remaining large tool outputs** the same way.
3. **As a last resort, summarize history** into a compact block, with the full transcript saved to disk.

Throughout all of this, the original task (a "goal anchor") and an agent-maintained progress note ride along so the agent never loses sight of what it's doing. You can also trigger **Compact now** or **Reset context** manually from the composer.

**Memory** is local and persistent. Agent V can proactively jot down notes about your preferences, your project's structure, and recurring issues, and it reads those notes back before forming an answer. Over time it can update a "user preferences & meta-rules" file so the same correction never has to be made twice.

---

## Privacy & Safety

Agent V is powerful, but it operates within firm boundaries:

- **Private by design.** It never transmits your file contents, API keys, or environment variables to outside servers, and it does not perform web searches by default.
- **Contained to your workspace.** File operations and shell commands stay inside the active project folder unless you explicitly ask otherwise.
- **Destructive actions are blocked.** The host stops catastrophic shell patterns (such as wiping drives or deleting root directories) before they can run.
- **Hardened dependencies.** Installs use pnpm with a minimum release age, blocked exotic sub-dependencies, and a frozen lockfile in CI and release builds.

---

## Where Your Data Lives

On Windows, Vyotiq stores its runtime data and logs under:

```
%APPDATA%\vyotiq\vyotiq\
```

Per-workspace artifacts (such as captured screenshots, compaction banners, and context summaries) are kept inside a `.vyotiq/` folder within the relevant project.

---

## Documentation

Deeper design notes live in the `docs/` folder, including:

- `context-management-design.md` — full design of the context-reduction system
- `context-compaction-design.md` — compaction strategy details
- `prompt-caching-audit.md` — how prompts are layered for provider caching
- `supply-chain-security.md` — dependency and install hardening
- `distribution.md` — packaging and release notes
- `e2e-testing.md` — end-to-end testing guide

The authoritative product and architecture specification is `project.md`, and `AGENTS.md` records learned preferences and workspace facts that Agent V relies on.

---

## License

This project is private (`"private": true`). All rights reserved by Vyotiq.
