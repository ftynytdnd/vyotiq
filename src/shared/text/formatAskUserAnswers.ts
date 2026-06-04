/**
 * Format structured `ask_user` answers for tool_result content and user-facing prose.
 */

import type { AskUserAnswer, AskUserStructuredPayload } from '../types/askUser.js';

export function formatAskUserDisplayFromAnswers(
  payload: AskUserStructuredPayload,
  answers: AskUserAnswer[],
  supplementText?: string
): string {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const lines: string[] = [];
  if (payload.title && payload.title.length > 0) {
    lines.push(payload.title);
    lines.push('');
  }
  for (const q of payload.questions) {
    const ans = byQuestion.get(q.id);
    lines.push(q.prompt);
    if (!ans || ans.skipped) {
      lines.push('  (skipped)');
    } else {
      const parts: string[] = [];
      if (ans.selectedOptionIds && ans.selectedOptionIds.length > 0) {
        for (const optId of ans.selectedOptionIds) {
          const opt = q.options.find((o) => o.id === optId);
          parts.push(opt ? `${opt.label} (${optId})` : optId);
        }
      }
      if (ans.freeText && ans.freeText.trim().length > 0) {
        parts.push(ans.freeText.trim());
      }
      lines.push(`  ${parts.length > 0 ? parts.join('; ') : '(no answer)'}`);
    }
    lines.push('');
  }
  const body = lines.join('\n').trim();
  const extra = supplementText?.trim();
  if (extra && extra.length > 0) {
    return body.length > 0 ? `${body}\n\n${extra}` : extra;
  }
  return body;
}

/** Machine-readable tool_result body the orchestrator sees on resume. */
export function formatAskUserToolResult(
  payload: AskUserStructuredPayload,
  answers: AskUserAnswer[],
  supplementText?: string
): string {
  const display = formatAskUserDisplayFromAnswers(payload, answers, supplementText);
  return display.length > 0
    ? `User answers:\n${display}`
    : 'User submitted without answering any questions.';
}
