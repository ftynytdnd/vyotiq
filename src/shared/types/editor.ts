/** Workspace file read/write for the in-app editor. */

export interface EditorReadInput {
  path: string;
  workspaceId?: string;
}

export interface EditorReadResult {
  content: string;
  mtimeMs: number;
  truncated: boolean;
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
