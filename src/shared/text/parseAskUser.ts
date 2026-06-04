/**
 * Parse `ask_user` tool arguments — structured multi-choice or legacy `question` string.
 */

import type { AskUserStructuredPayload } from '../types/askUser.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseOption(raw: unknown): { id: string; label: string } | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  const label = typeof raw['label'] === 'string' ? raw['label'].trim() : '';
  if (!id || !label) return null;
  return { id, label };
}

function parseQuestion(raw: unknown): AskUserStructuredPayload['questions'][number] | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
  const prompt = typeof raw['prompt'] === 'string' ? raw['prompt'].trim() : '';
  if (!id || !prompt) return null;
  const optionsRaw = raw['options'];
  if (!Array.isArray(optionsRaw) || optionsRaw.length === 0) return null;
  const options = optionsRaw.map(parseOption).filter((o): o is NonNullable<typeof o> => o !== null);
  if (options.length === 0) return null;
  const allowMultiple = raw['allow_multiple'] === true || raw['allowMultiple'] === true;
  return {
    id,
    prompt,
    options,
    ...(allowMultiple ? { allow_multiple: true } : {})
  };
}

/** Normalize parsed tool args into structured payload or legacy single question. */
export function parseAskUserArgs(parsed: unknown): {
  structured?: AskUserStructuredPayload;
  legacyQuestion?: string;
  displayText: string;
} {
  if (!isRecord(parsed)) {
    return {
      displayText: 'Could you clarify how you would like me to proceed?'
    };
  }

  const title = typeof parsed['title'] === 'string' ? parsed['title'].trim() : undefined;
  const questionsRaw = parsed['questions'];
  if (Array.isArray(questionsRaw) && questionsRaw.length > 0) {
    const questions = questionsRaw
      .map(parseQuestion)
      .filter((q): q is NonNullable<typeof q> => q !== null);
    if (questions.length > 0) {
      const structured: AskUserStructuredPayload = {
        ...(title && title.length > 0 ? { title } : {}),
        questions
      };
      return {
        structured,
        displayText: formatAskUserDisplayText(structured)
      };
    }
  }

  const legacy =
    typeof parsed['question'] === 'string' && parsed['question'].trim().length > 0
      ? parsed['question'].trim()
      : undefined;
  if (legacy) {
    return { legacyQuestion: legacy, displayText: legacy };
  }

  return {
    displayText: 'Could you clarify how you would like me to proceed?'
  };
}

function legacyQuestionToPayload(question: string): AskUserStructuredPayload {
  return {
    questions: [
      {
        id: 'legacy',
        prompt: question,
        options: []
      }
    ]
  };
}

/** Normalize any parsed ask_user args into a structured payload for the overlay UI. */
export function resolveAskUserPayload(parsed: ReturnType<typeof parseAskUserArgs>): AskUserStructuredPayload {
  if (parsed.structured) return parsed.structured;
  const q = parsed.legacyQuestion ?? parsed.displayText;
  return legacyQuestionToPayload(q);
}

export function formatAskUserDisplayText(payload: AskUserStructuredPayload): string {
  const lines: string[] = [];
  if (payload.title && payload.title.length > 0) {
    lines.push(payload.title);
    lines.push('');
  }
  for (const q of payload.questions) {
    lines.push(q.prompt);
    for (const opt of q.options) {
      lines.push(`  - ${opt.label} (${opt.id})`);
    }
    if (q.allow_multiple) {
      lines.push('  (select one or more)');
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}
