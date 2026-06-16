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

export interface LspRelayStatus {
  connected: boolean;
  pid: number | null;
  lastError: string | null;
}

export interface LspConnectResult {
  ok: boolean;
  rootUri: string;
  status: LspRelayStatus;
  configSource: 'global' | 'workspace' | 'disabled' | 'bundled';
  languageId?: string;
  reason?: string;
}

export interface LspMessageEvent {
  workspaceId: string;
  message: string;
}
