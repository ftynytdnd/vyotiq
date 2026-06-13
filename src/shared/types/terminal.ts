/** Workspace PTY session IPC types. */

export interface TerminalAttachInput {
  workspaceId: string;
}

export interface TerminalAttachResult {
  ok: true;
  shell: string;
  cols: number;
  rows: number;
}

export interface TerminalInputPayload {
  workspaceId: string;
  data: string;
}

export interface TerminalResizePayload {
  workspaceId: string;
  cols: number;
  rows: number;
}

export interface TerminalDataEvent {
  workspaceId: string;
  data: string;
}

export interface TerminalExitEvent {
  workspaceId: string;
  exitCode: number;
  signal?: number;
}
