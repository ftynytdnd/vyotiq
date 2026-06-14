/** Workspace file read/write for the in-app editor. */

export type EditorEol = 'crlf' | 'lf';

export type EditorEncoding =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'utf-32le'
  | 'utf-32be';

export interface EditorReadInput {
  path: string;
  workspaceId?: string;
}

export interface EditorReadResult {
  content: string;
  mtimeMs: number;
  truncated: boolean;
  /** Detected line-ending style on disk (for the status bar). */
  eol: EditorEol;
  /** Detected on-disk text encoding (for the status bar). */
  encoding: EditorEncoding;
  /** True when a UTF-8 BOM was present. */
  utf8Bom: boolean;
}

export interface EditorWriteInput {
  path: string;
  content: string;
  workspaceId?: string;
  /** When set, refuse write if on-disk mtime differs (optimistic concurrency). */
  expectedMtimeMs?: number;
}

export interface EditorWriteResult {
  ok: true;
  mtimeMs: number;
}

export interface EditorWriteConflict {
  ok: false;
  reason: 'conflict';
  mtimeMs: number;
}

export type EditorWriteReply = EditorWriteResult | EditorWriteConflict;
