/**
 * Render a timeline as human-readable Markdown for export.
 */

import type { TimelineEvent } from '../types/chat.js';

function coalesceStreaming(events: ReadonlyArray<TimelineEvent>): {
  textById: Map<string, string>;
  reasoningById: Map<string, string>;
} {
  const textById = new Map<string, string>();
  const reasoningById = new Map<string, string>();
  for (const e of events) {
    switch (e.kind) {
      case 'agent-text-delta':
        textById.set(e.id, (textById.get(e.id) ?? '') + e.delta);
        break;
      case 'agent-reasoning-delta':
        reasoningById.set(e.id, (reasoningById.get(e.id) ?? '') + e.delta);
        break;
      default:
        break;
    }
  }
  return { textById, reasoningById };
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

/**
 * Full-fidelity markdown export (no per-block truncation).
 */
export function renderTranscriptMarkdown(
  events: ReadonlyArray<TimelineEvent>,
  title?: string
): string {
  const lines: string[] = [];
  if (title && title.trim().length > 0) {
    lines.push(`# ${title.trim()}`, '');
  }

  const { textById, reasoningById } = coalesceStreaming(events);
  const seenAssistantIds = new Set<string>();

  for (const e of events) {
    switch (e.kind) {
      case 'user-prompt':
        lines.push(`## User · ${formatTimestamp(e.ts)}`, '', e.content, '');
        break;
      case 'agent-text-delta':
      case 'agent-text-end':
      case 'agent-reasoning-delta':
      case 'agent-reasoning-end':
      case 'agent-text-aborted': {
        if (seenAssistantIds.has(e.id)) break;
        seenAssistantIds.add(e.id);
        const text = textById.get(e.id) ?? '';
        const reasoning = reasoningById.get(e.id) ?? '';
        if (text.length === 0 && reasoning.length === 0) break;
        lines.push(`## Agent · ${formatTimestamp(e.ts)}`);
        if (reasoning.length > 0) {
          lines.push('', '<details><summary>Reasoning</summary>', '', reasoning, '', '</details>');
        }
        if (text.length > 0) {
          lines.push('', text);
        }
        lines.push('');
        break;
      }
      case 'tool-call':
        lines.push(
          `### Tool call · \`${e.call.name}\` · ${formatTimestamp(e.ts)}`,
          '',
          '```json',
          JSON.stringify(e.call.args ?? {}, null, 2),
          '```',
          ''
        );
        break;
      case 'tool-result': {
        const status = e.result.ok ? 'ok' : 'failed';
        lines.push(
          `### Tool result · \`${e.result.name}\` (${status}) · ${formatTimestamp(e.ts)}`,
          '',
          '```',
          e.result.output,
          '```',
          ''
        );
        break;
      }
      case 'ask-user-prompt':
        lines.push(`### Ask user · ${formatTimestamp(e.ts)}`, '', e.displayText, '');
        break;
      case 'ask-user-submitted':
        lines.push(`### User answered (ask_user) · ${formatTimestamp(e.ts)}`, '');
        break;
      case 'error':
        lines.push(`### Error · ${formatTimestamp(e.ts)}`, '', e.message, '');
        break;
      case 'run-status':
        lines.push(`### Run ${e.phase} · ${formatTimestamp(e.ts)}`, '', e.label, '');
        break;
      case 'file-edit':
        lines.push(
          `### File edit · \`${e.filePath}\` · ${formatTimestamp(e.ts)}`,
          '',
          `- Lines added: ${e.additions}`,
          `- Lines removed: ${e.deletions}`,
          ''
        );
        break;
      case 'phase':
        lines.push(`_Phase: ${e.label}_ · ${formatTimestamp(e.ts)}`, '');
        break;
      case 'phase-gate':
        lines.push(
          `_Phase gate (${e.phase}): ${e.gateDecision.kind} — ${e.gateDecision.reason}_ · ${formatTimestamp(e.ts)}`,
          ''
        );
        break;
      case 'phase-ledger-entry':
        lines.push(`_Ledger (${e.phase}, seq ${e.seq})_ · ${formatTimestamp(e.ts)}`, '');
        break;
      case 'agent-thought':
        lines.push(`_Thought:_ ${e.content}`, '');
        break;
      case 'token-usage':
      case 'context-usage':
      case 'context-summary':
      case 'tool-compacted':
      case 'tool-call-args-delta':
      case 'diff-stream':
      case 'tool-output-delta':
      case 'checkpoint-entry':
      case 'checkpoint-revert':
      case 'checkpoint-bash-mutation':
      case 'synthetic-usage-update':
      case 'attachment-pre-read':
        break;
      default: {
        const _exhaustive: never = e;
        void _exhaustive;
        break;
      }
    }
  }

  if (lines.length === 0) {
    return title ? `# ${title}\n\n_(empty transcript)_\n` : '_(empty transcript)_\n';
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
