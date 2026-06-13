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

export interface LspDiagnosticsEvent {
  workspaceId: string;
  path: string;
  diagnostics: LspDiagnostic[];
}
