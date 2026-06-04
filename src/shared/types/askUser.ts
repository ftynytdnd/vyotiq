/**
 * Structured `ask_user` tool payload (Cursor-like multi-choice).
 */

interface AskUserOption {
  id: string;
  label: string;
}

interface AskUserQuestion {
  id: string;
  prompt: string;
  options: AskUserOption[];
  allow_multiple?: boolean;
}

export interface AskUserStructuredPayload {
  title?: string;
  questions: AskUserQuestion[];
}

/** One question's answer from the interactive AskUser overlay. */
export interface AskUserAnswer {
  questionId: string;
  /** When true, the user explicitly skipped this question. */
  skipped?: boolean;
  selectedOptionIds?: string[];
  freeText?: string;
}

/** Renderer → main: resume a paused run with structured answers. */
export interface AskUserSubmitInput {
  runId: string;
  conversationId: string;
  /** Id of the persisted `ask-user-prompt` timeline row. */
  promptEventId: string;
  toolCallId: string;
  payload: AskUserStructuredPayload;
  answers: AskUserAnswer[];
  /** Optional freeform supplement from the composer textarea. */
  supplementText?: string;
}

export type AskUserSubmitReply =
  | { ok: true }
  | {
    ok: false;
    kind: 'unknown-run' | 'not-awaiting-user' | 'unknown-conversation';
    message?: string;
  };
