/**
 * Tool types. Tools are the actuators Agent V uses to affect the environment.
 * Each tool is implemented in its own file in `src/main/tools/*.tool.ts` and
 * registered in `src/main/tools/registry.ts`.
 *
 * `ToolResult.data` is a discriminated union keyed by `tool`. It carries the
 * structured, typed payload that the renderer's per-tool invocation UI reads
 * from. `output` remains a plain string so the LLM contract is unchanged.
 */

/**
 * Tool names actually present in the registry — the canonical actuator
 * catalogue. Every entry maps 1:1 to a file under `src/main/tools/*.tool.ts`.
 */
export type RegisteredToolName =
  | 'bash'
  | 'ls'
  | 'read'
  | 'edit'
  | 'delete'
  | 'search'
  | 'memory'
  | 'recall'
  | 'report';

/**
 * The set of tool names that may appear on a `ToolCall` / `ToolResult`.
 * Includes the `'unknown'` sentinel used at the result boundary when an
 * inbound tool name does not match any registered tool — it lets the
 * renderer render an explicit "unknown tool" placeholder instead of
 * misclassifying an unrecognised result as a bash invocation. The
 * orchestrator never emits a `ToolCall` with `name: 'unknown'`; the value
 * only appears on `ToolResult.name` when `runToolByName` cannot resolve
 * the requested tool.
 */
export type ToolName = RegisteredToolName | 'unknown';

export interface ToolCall {
  /** Unique id per call (used for streaming UI updates). */
  id: string;
  /** Which tool. */
  name: ToolName;
  /** Free-form structured arguments. Each tool validates its own shape. */
  args: Record<string, unknown>;
  /**
   * Gemini-only: opaque encrypted signature attached to a `functionCall`
   * part. Gemini 3 enforces strict round-trip on the "Current Turn"
   * (every model functionCall step since the last user-text message); a
   * missing signature on the first functionCall part of any step in the
   * current turn causes a 400 "thought_signature is missing" error.
   *
   * Only populated by the `gemini-native` transport. The `anthropic-native`
   * dialect attaches its analogous signature to the assistant message via
   * `ChatMessage.reasoning_signature`, NOT per tool call (Anthropic's
   * `thinking` block is sibling to `tool_use`, not embedded inside it).
   *
   * Source: https://ai.google.dev/gemini-api/docs/thought-signatures
   *         https://ai.google.dev/gemini-api/docs/gemini-3
   */
  thoughtSignature?: string;
}

/** One entry in an `ls` listing. */
interface LsEntry {
  /** Workspace-relative path. Directories end with `/`. */
  rel: string;
  type: 'file' | 'dir';
}

/** One line in a unified diff hunk. */
export interface DiffLine {
  kind: '+' | '-' | ' ';
  text: string;
}

/** One hunk in a unified diff. */
export interface DiffHunk {
  /** 1-indexed start line in the BEFORE content. */
  oldStart: number;
  /** 1-indexed start line in the AFTER content. */
  newStart: number;
  lines: DiffLine[];
}

/** One match in a local search. */
export interface SearchMatch {
  /** Workspace-relative path. */
  path: string;
  /** 1-indexed line number. */
  line: number;
  /** Trimmed line preview. */
  preview: string;
}

export type ToolData =
  | {
    tool: 'bash';
    command: string;
    stdout: string;
    stderr: string;
    /** Null if killed by signal. */
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }
  | {
    tool: 'ls';
    path: string;
    depth: number;
    entries: LsEntry[];
    truncated: boolean;
  }
  | {
    tool: 'read';
    path: string;
    /** 1-indexed inclusive range actually returned. */
    fromLine: number;
    toLine: number;
    /** Total lines in the file (after byte cap). */
    totalLines: number;
    /** Plain file content for the returned range — no numbering prefix. */
    content: string;
    truncated: boolean;
  }
  | {
    tool: 'edit';
    filePath: string;
    additions: number;
    deletions: number;
    created: boolean;
    /** Populated on modify (not on create). */
    hunks?: DiffHunk[];
    /** Populated on create. Full file content the model just wrote. */
    createdContent?: string;
    replacedOccurrences?: number;
  }
  | {
    /**
     * `delete` — unlinks a file after snapshotting its pre-state into
     * the checkpoint store. Sub-agent-only by policy (the orchestrator
     * never mutates files directly). The renderer surfaces the card
     * identically to an edit with `kind: 'delete'`.
     */
    tool: 'delete';
    filePath: string;
    /** Number of lines the deleted file had. */
    deletedLines: number;
  }
  | {
    tool: 'search';
    mode: 'local' | 'web';
    query: string;
    /** Populated only in `local` mode. */
    matches?: SearchMatch[];
    /** Populated only in `web` mode. */
    webBody?: string;
    webContentType?: string;
    truncated: boolean;
  }
  | {
    tool: 'memory';
    action: 'list' | 'read' | 'write' | 'append';
    scope: 'global' | 'workspace';
    key?: string;
    /** For `read`/`list`: markdown body or list rendered as markdown. */
    preview?: string;
    /** For `list`: number of notes. */
    count?: number;
  }
  | {
    /**
     * Cross-conversation recall — orchestrator-only tool that lets the
     * agent see other conversations the user has had with it. Two
     * actions:
     *   - `list`: enumerate the recent conversation index (no body).
     *   - `read`: fetch a compact transcript view of one conversation.
     * Sub-agents are denied this tool by policy so the isolation
     * invariant (`04-subagent-prompt.md`) stays intact.
     */
    tool: 'recall';
    action: 'list' | 'read';
    /** For `read`: the conversation id that was queried. */
    conversationId?: string;
    /** For `list`: how many conversations are visible to the agent. */
    count?: number;
    /** Markdown body the renderer can show on expand. */
    preview?: string;
  }
  | {
    /**
     * `report` — sub-agent-only tool that writes a self-contained HTML
     * deliverable to `<workspace>/.vyotiq/reports/`. The renderer card
     * surfaces an "Open in browser" button that hands the file to the
     * OS default browser via `shell.openPath`.
     *
     * Self-contained means: zero remote fetches at view time. A strict
     * CSP meta tag in the saved file enforces `default-src 'none'`
     * with inline-style/script allowances.
     */
    tool: 'report';
    /** Title from the model — also used in the doc `<title>` and the card header. */
    title: string;
    /** Workspace-relative path where the file landed (e.g. `.vyotiq/reports/foo-20260510-142500.html`). */
    filePath: string;
    /** On-disk size in bytes (after the full HTML shell). */
    sizeBytes: number;
  };

export interface ToolResult {
  id: string;
  name: ToolName;
  ok: boolean;
  /** Human-readable result text fed back to the model. */
  output: string;
  /** Typed, structured payload keyed by tool. Optional only for `ok: false`. */
  data?: ToolData;
  /** If !ok, error message (also included in `output`). */
  error?: string;
  /** Wall-clock ms. */
  durationMs: number;
}


