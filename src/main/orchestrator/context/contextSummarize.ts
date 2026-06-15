/**
 * Reversible structured summarization — the last-resort lossy reduction lever.
 *
 * When reversible offload (tool-result clearing + on-disk compaction) cannot
 * keep the prompt under the trigger threshold, the host collapses prior history
 * into a single structured `<context_summary>` block (mirrors Anthropic
 * server-side compaction / Claude Code `/compact`). The full pre-summary
 * transcript is written to `.vyotiq/context-summaries/...` first, so the
 * reduction stays recoverable: the agent can `read` the artifact and the user
 * can inspect it.
 *
 * The structured template preserves what continues to constrain future work —
 * task intent, key decisions, files changed, failed approaches, open questions,
 * next steps — rather than a prose blurb that reads well but is useless to an
 * agent (2026 context-engineering guidance).
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { logger } from '../../logging/logger.js';
import { streamChat } from '../../providers/chatClient.js';
import { isProviderError } from '../../providers/providerError.js';
import { redactUserHomeInText } from '@shared/path/redactUserHomeInPath.js';
import { redactChatMessagesForProvider } from './redactChatMessagesForProvider.js';
import {
  removeSummaryArtifact,
  writeSummaryArtifact,
  SUMMARY_RECOVERY_HINT
} from './compactionArtifacts.js';

const log = logger.child('orch/contextSummarize');

/** Marker prefix so summary messages are detectable on inspection / replay. */
export const CONTEXT_SUMMARY_OPEN = '<context_summary>';
const CONTEXT_SUMMARY_CLOSE = '</context_summary>';

/** Upper bound on the summary response so it can never itself bloat context. */
const SUMMARY_MAX_TOKENS = 1_600;

const SUMMARY_SYSTEM_PROMPT = [
  'You are compacting an in-progress AI coding agent session so it can continue',
  'from a lean context without losing anything that constrains future work.',
  'Read the transcript and produce a faithful, information-dense summary.',
  'Maximize recall first (capture every load-bearing detail), then trim noise.',
  'Do NOT invent facts. Do NOT include redundant tool output that the agent can',
  're-read from the workspace. Write in terse Markdown under these exact headings:',
  '',
  '## Task intent',
  '## Key decisions',
  '## Files changed',
  '## Failed approaches',
  '## Open questions',
  '## Next steps'
].join('\n');

/** Flatten a history slice into a plain-text transcript for summarization + recovery. */
export function serializeHistoryTranscript(history: readonly ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of history) {
    const role = m.role.toUpperCase();
    if (typeof m.content === 'string' && m.content.length > 0) {
      lines.push(`[${role}] ${m.content}`);
    }
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        lines.push(`[${role} → ${tc.function.name}] ${tc.function.arguments}`);
      }
    }
    if (m.role === 'tool' && typeof m.content !== 'string') {
      lines.push(`[TOOL ${m.name ?? ''}] (non-text result)`);
    }
  }
  return lines.join('\n\n');
}

/** Build the in-context summary message content (used live and on replay). */
export function buildContextSummaryMessage(summary: string, relativePath: string): string {
  const trimmed = summary.trim();
  return `${CONTEXT_SUMMARY_OPEN}\n${trimmed}\n\nThe earlier conversation was compacted to keep the working context focused.${SUMMARY_RECOVERY_HINT}${relativePath} (use \`read\` to restore full detail).\n${CONTEXT_SUMMARY_CLOSE}`;
}

/** True when a message body is a host-generated context-summary block. */
export function isContextSummaryContent(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.startsWith(CONTEXT_SUMMARY_OPEN);
}

export interface SummarizeHistoryOpts {
  history: readonly ChatMessage[];
  providerId: string;
  modelId: string;
  conversationId: string;
  runId: string;
  workspacePath: string;
  signal?: AbortSignal;
}

export interface SummarizeHistoryResult {
  summary: string;
  relativePath: string;
  originalChars: number;
  originalMessages: number;
}

/**
 * Summarize `history` into a structured block and persist the full transcript.
 * Returns `null` (caller keeps the raw history) when there is nothing
 * meaningful to summarize or the model call fails — summarization must never
 * destroy context it could not replace.
 */
export async function summarizeHistory(
  opts: SummarizeHistoryOpts
): Promise<SummarizeHistoryResult | null> {
  const transcript = redactUserHomeInText(serializeHistoryTranscript(opts.history));
  if (transcript.trim().length === 0) return null;

  let relativePath: string;
  try {
    relativePath = await writeSummaryArtifact(
      opts.workspacePath,
      opts.conversationId,
      opts.runId,
      transcript
    );
  } catch (err) {
    log.warn('failed to persist pre-summary transcript — aborting summarization', {
      runId: opts.runId,
      err: err instanceof Error ? err.message : String(err)
    });
    return null;
  }

  let summary = '';
  try {
    const stream = streamChat({
      providerId: opts.providerId,
      model: opts.modelId,
      messages: redactChatMessagesForProvider([
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Summarize this agent session transcript:\n\n${transcript}`
        }
      ]),
      toolChoice: 'none',
      maxTokens: SUMMARY_MAX_TOKENS,
      ...(opts.signal ? { signal: opts.signal } : {})
    });
    for await (const delta of stream) {
      if (typeof delta.contentDelta === 'string') summary += delta.contentDelta;
    }
  } catch (err) {
    const msg = isProviderError(err)
      ? err.friendlyMessage
      : err instanceof Error
        ? err.message
        : String(err);
    log.warn('summarization model call failed — keeping raw history', {
      runId: opts.runId,
      err: msg
    });
    await removeSummaryArtifact(opts.workspacePath, relativePath);
    return null;
  }

  if (summary.trim().length === 0) {
    log.warn('summarization produced empty output — keeping raw history', {
      runId: opts.runId
    });
    await removeSummaryArtifact(opts.workspacePath, relativePath);
    return null;
  }

  return {
    summary: summary.trim(),
    relativePath,
    originalChars: transcript.length,
    originalMessages: opts.history.length
  };
}
