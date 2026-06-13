/**
 * Inline `@` mentions in the composer — distinct from attachment pills.
 * Only picked file mentions become `MentionRef` entries; unpicked `@` text
 * stays literal in the serialized prompt.
 */

export type MentionKind = 'file' | 'symbol' | 'doc' | 'conversation' | 'web';

/** Resolved mention carried on user-prompt events and the chat send wire. */
export interface MentionRef {
  kind: MentionKind;
  /** Stable id within the composer document (chip `data-mention-id`). */
  id: string;
  /** User-facing label — usually the workspace-relative path for files. */
  label: string;
  /** Workspace-relative path when the file lives in the active project. */
  workspacePath?: string;
  /** Absolute path under app userData when ingested from the computer. */
  storedPath?: string;
  mimeType?: string;
  sizeBytes?: number;
  external?: boolean;
  /** 1-based line for symbol mentions. */
  line?: number;
  /** Conversation id for conversation mentions. */
  conversationId?: string;
}
