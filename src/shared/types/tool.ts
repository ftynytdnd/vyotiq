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
  | 'sg'
  | 'memory'
  | 'recall'
  | 'report'
  | 'capture'
  | 'finish'
  | 'ask_user';

/**
 * Runtime catalogue of registered tool names — the single source of truth
 * for code that needs the names at runtime (the registry, the policy
 * allowlist, and the provider-name normalizer). Shared code cannot import
 * the main-process registry, so this array lives here and the assertion
 * below guarantees it stays in lock-step with `RegisteredToolName`:
 * dropping or adding a union member without updating this array is a
 * compile error.
 */
export const REGISTERED_TOOL_NAMES = [
  'bash',
  'ls',
  'read',
  'edit',
  'delete',
  'search',
  'sg',
  'memory',
  'recall',
  'report',
  'capture',
  'finish',
  'ask_user'
] as const satisfies readonly RegisteredToolName[];

// Compile-time completeness guard: fails if any `RegisteredToolName` is
// missing from `REGISTERED_TOOL_NAMES` above.
type _AllRegisteredNamesCovered =
  Exclude<RegisteredToolName, (typeof REGISTERED_TOOL_NAMES)[number]> extends never
    ? true
    : never;
const _allRegisteredNamesCovered: _AllRegisteredNamesCovered = true;
void _allRegisteredNamesCovered;

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

/** One match in an ast-grep search. */
export interface SearchMatch {
  /** Workspace-relative path. */
  path: string;
  /** 1-indexed line number. */
  line: number;
  /** Trimmed line preview. */
  preview: string;
  /** Full matched node text when available (structural search). */
  matchedText?: string;
}

export type ToolData =
  | {
    tool: 'bash';
    command: string;
    /** Shell that executed the command (UI display). */
    runtime?: 'powershell' | 'bash';
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
    /** True when decoded text looks garbled (high ? / NUL ratio). */
    garbled?: boolean;
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
    /** Checkpoint pending-entry id when the edit was recorded. */
    entryId?: string;
  }
  | {
    /** `delete` — unlinks a file after snapshotting its pre-state into the checkpoint store. */
    tool: 'delete';
    filePath: string;
    /** Number of lines the deleted file had. */
    deletedLines: number;
  }
  | {
    tool: 'search';
    query: string;
    pattern?: string;
    matcher?: 'ast' | 'regex';
    autoNote?: string;
    kind?: string;
    zeroHitHints?: string;
    debugQuery?: string;
    language?: string;
    inferenceSource?: 'explicit' | 'glob' | 'path' | 'workspace' | 'default';
    matches?: SearchMatch[];
    truncated: boolean;
  }
  | {
    tool: 'sg';
    action: 'run' | 'scan' | 'test';
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }
  | {
    tool: 'report';
    title: string;
    /** Workspace-relative path under `.vyotiq/reports/`. */
    relPath: string;
    bytes: number;
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
     * Cross-conversation recall — list or read other conversations in this workspace.
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


