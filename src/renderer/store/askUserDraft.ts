/**
 * Shared draft state for interactive `ask_user` — panel overlay and composer
 * Send both read/write the same answers before calling `submitAskUser`.
 */

import { create } from 'zustand';
import type { AskUserAnswer, AskUserStructuredPayload } from '@shared/types/askUser.js';

export type QuestionDraft = {
  skipped: boolean;
  selected: Set<string>;
  freeText: string;
};

function emptyDrafts(payload: AskUserStructuredPayload): Record<string, QuestionDraft> {
  const out: Record<string, QuestionDraft> = {};
  for (const q of payload.questions) {
    out[q.id] = { skipped: false, selected: new Set(), freeText: '' };
  }
  return out;
}

interface AskUserDraftStore {
  byPromptId: Record<string, Record<string, QuestionDraft>>;
  ensureDraft: (promptEventId: string, payload: AskUserStructuredPayload) => void;
  clearDraft: (promptEventId: string) => void;
  toggleOption: (
    promptEventId: string,
    questionId: string,
    optionId: string,
    allowMultiple: boolean
  ) => void;
  skipQuestion: (promptEventId: string, questionId: string) => void;
  setFreeText: (promptEventId: string, questionId: string, text: string, allowMultiple?: boolean) => void;
  buildAnswers: (promptEventId: string, payload: AskUserStructuredPayload) => AskUserAnswer[];
  hasAnyAnswer: (
    promptEventId: string,
    payload: AskUserStructuredPayload,
    supplementText?: string
  ) => boolean;
}

export const useAskUserDraftStore = create<AskUserDraftStore>((set, get) => ({
  byPromptId: {},

  ensureDraft: (promptEventId, payload) => {
    if (get().byPromptId[promptEventId]) return;
    set((s) => ({
      byPromptId: { ...s.byPromptId, [promptEventId]: emptyDrafts(payload) }
    }));
  },

  clearDraft: (promptEventId) => {
    set((s) => {
      if (!(promptEventId in s.byPromptId)) return s;
      const next = { ...s.byPromptId };
      delete next[promptEventId];
      return { byPromptId: next };
    });
  },

  toggleOption: (promptEventId, questionId, optionId, allowMultiple) => {
    set((s) => {
      const sheet = s.byPromptId[promptEventId];
      if (!sheet) return s;
      const cur = sheet[questionId] ?? { skipped: false, selected: new Set(), freeText: '' };
      const nextSelected = new Set(cur.selected);
      if (allowMultiple) {
        if (nextSelected.has(optionId)) nextSelected.delete(optionId);
        else nextSelected.add(optionId);
      } else {
        nextSelected.clear();
        nextSelected.add(optionId);
      }
      return {
        byPromptId: {
          ...s.byPromptId,
          [promptEventId]: {
            ...sheet,
            [questionId]: {
              ...cur,
              skipped: false,
              selected: nextSelected,
              freeText: allowMultiple ? cur.freeText : ''
            }
          }
        }
      };
    });
  },

  skipQuestion: (promptEventId, questionId) => {
    set((s) => {
      const sheet = s.byPromptId[promptEventId];
      if (!sheet) return s;
      return {
        byPromptId: {
          ...s.byPromptId,
          [promptEventId]: {
            ...sheet,
            [questionId]: { skipped: true, selected: new Set(), freeText: '' }
          }
        }
      };
    });
  },

  setFreeText: (promptEventId, questionId, text, allowMultiple = false) => {
    set((s) => {
      const sheet = s.byPromptId[promptEventId];
      if (!sheet) return s;
      const cur = sheet[questionId] ?? { skipped: false, selected: new Set(), freeText: '' };
      const trimmed = text.trim();
      const clearOptions = !allowMultiple && trimmed.length > 0 && cur.selected.size > 0;
      return {
        byPromptId: {
          ...s.byPromptId,
          [promptEventId]: {
            ...sheet,
            [questionId]: {
              ...cur,
              skipped: false,
              freeText: text,
              selected: clearOptions ? new Set<string>() : cur.selected
            }
          }
        }
      };
    });
  },

  buildAnswers: (promptEventId, payload) => {
    const sheet = get().byPromptId[promptEventId] ?? emptyDrafts(payload);
    return payload.questions.map((q) => {
      const d = sheet[q.id] ?? { skipped: false, selected: new Set(), freeText: '' };
      if (d.skipped) return { questionId: q.id, skipped: true };
      return {
        questionId: q.id,
        selectedOptionIds: [...d.selected],
        ...(d.freeText.trim().length > 0 ? { freeText: d.freeText.trim() } : {})
      };
    });
  },

  hasAnyAnswer: (promptEventId, payload, supplementText) => {
    if (supplementText && supplementText.trim().length > 0) return true;
    const sheet = get().byPromptId[promptEventId];
    if (!sheet) return false;
    for (const q of payload.questions) {
      const d = sheet[q.id];
      if (!d || d.skipped) continue;
      if (d.selected.size > 0) return true;
      if (d.freeText.trim().length > 0) return true;
    }
    return false;
  }
}));

/** Test helper — reset all drafts. */
export function resetAskUserDraftsForTests(): void {
  useAskUserDraftStore.setState({ byPromptId: {} });
}
