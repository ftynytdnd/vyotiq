/**
 * Inline completion IPC types — editor FIM + composer prompt continuation.
 */

export type CompletionKind = 'editor' | 'composer';

export interface CompletionInput {
  kind: CompletionKind;
  /** Monotonic id from renderer; stale replies are ignored client-side. */
  requestId: number;
  providerId: string;
  model: string;
  prefix: string;
  suffix?: string;
  filePath?: string;
  workspaceId?: string;
}

export interface CompletionReply {
  requestId: number;
  text: string;
}
