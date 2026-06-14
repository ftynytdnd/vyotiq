/** Workspace PTY session IPC types (multi-session per workspace). */

/** Metadata describing one live PTY session. */
export interface TerminalSessionMeta {
  /** Globally-unique session id. */
  sessionId: string;
  /** Workspace this session belongs to. */
  workspaceId: string;
  /** Resolved shell label (e.g. `powershell.exe`). */
  shell: string;
  cols: number;
  rows: number;
  /**
   * The primary session is the one the agent `bash` tool shares. The
   * first session created for a workspace is primary; extra user
   * sessions are not.
   */
  primary: boolean;
}

export interface TerminalAttachInput {
  workspaceId: string;
}

/**
 * Ensures the workspace's primary session exists and returns the full
 * set of live sessions for that workspace so the renderer can rehydrate
 * its session strip when the panel is reopened.
 */
export interface TerminalAttachResult {
  ok: true;
  sessions: TerminalSessionMeta[];
}

export interface TerminalCreateInput {
  workspaceId: string;
}

export interface TerminalCreateResult {
  ok: true;
  session: TerminalSessionMeta;
}

export interface TerminalListInput {
  workspaceId: string;
}

export interface TerminalListResult {
  sessions: TerminalSessionMeta[];
}

export interface TerminalCloseInput {
  sessionId: string;
}

export interface TerminalInputPayload {
  sessionId: string;
  data: string;
}

export interface TerminalResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalRestartInput {
  sessionId: string;
}

export interface TerminalDataEvent {
  workspaceId: string;
  sessionId: string;
  data: string;
}

export interface TerminalExitEvent {
  workspaceId: string;
  sessionId: string;
  exitCode: number;
  signal?: number;
}
