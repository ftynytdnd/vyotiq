/**
 * Vector re-index progress events (main → renderer).
 */

export interface VectorReindexProgressEvent {
  phase: 'start' | 'workspace' | 'done' | 'error';
  workspaceId?: string;
  workspaceLabel?: string;
  index?: number;
  total?: number;
  message?: string;
}
