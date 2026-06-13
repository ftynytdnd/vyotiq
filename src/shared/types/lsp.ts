/**
 * LSP types shared across main and renderer.
 */

export interface LspDiagnostic {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface LspLocation {
  filePath: string;
  line: number;
  character: number;
}

export interface LspCompletionItem {
  label: string;
  insertText: string;
  detail?: string;
}

export interface LspDiagnosticsEvent {
  workspaceId: string;
  path: string;
  diagnostics: LspDiagnostic[];
}

export interface LspRelayStatus {
  connected: boolean;
  pid: number | null;
  lastError: string | null;
}

export interface LspConnectResult {
  ok: boolean;
  rootUri: string;
  status: LspRelayStatus;
  configSource: 'global' | 'workspace' | 'disabled';
  reason?: string;
}

export interface LspMessageEvent {
  workspaceId: string;
  message: string;
}
