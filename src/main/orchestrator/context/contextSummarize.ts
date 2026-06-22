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
import type { ContextManagementSettings } from '@shared/settings/agentBehaviorSettings.js';
import { logger } from '../../logging/logger.js';
import { streamChat } from '../../providers/chatClient.js';
import { getProviderWithKey } from '../../providers/providerStore.js';
import { isProviderError } from '../../providers/providerError.js';
import { redactUserHomeInText } from '@shared/path/redactUserHomeInPath.js';
import { redactChatMessagesForProvider } from './redactChatMessagesForProvider.js';
import {
  removeSummaryArtifact,
  writeSummaryArtifact,
  SUMMARY_RECOVERY_HINT
} from './compactionArtifacts.js';
import {
  billingBlockKeyForSelection,
  getRecentBillingBlock,
  setRecentBillingBlock
} from '../loop/recentBillingBlock.js';

const log = logger.child('orch/contextSummarize');

/** Marker prefix so summary messages are detectable on inspection / replay. */
export const CONTEXT_SUMMARY_OPEN = '<context_summary>';
const CONTEXT_SUMMARY_CLOSE = '</context_summary>';

/** Upper bound on the summary response so it can never itself bloat context. */
const SUMMARY_MAX_TOKENS = 1_600;

/** Cap model attempts so a manual reset cannot fan out across every discovered model. */
const MAX_SUMMARIZATION_CANDIDATES = 8;

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

export interface SummarizationCandidate {
  providerId: string;
  modelId: string;
}

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

function candidateKey(candidate: SummarizationCandidate): string {
  return billingBlockKeyForSelection(candidate);
}

function tryAddCandidate(
  out: SummarizationCandidate[],
  seen: Set<string>,
  candidate: SummarizationCandidate
): void {
  const providerId = candidate.providerId.trim();
  const modelId = candidate.modelId.trim();
  if (providerId.length === 0 || modelId.length === 0) return;
  const key = candidateKey({ providerId, modelId });
  if (seen.has(key)) return;
  if (getRecentBillingBlock({ providerId, modelId })) return;
  seen.add(key);
  out.push({ providerId, modelId });
}

/**
 * Ordered summarization model candidates: dedicated summary model (when set),
 * the run model, then sibling models on those providers. Skips models recently
 * blocked by billing/subscription errors.
 */
export async function resolveSummarizationCandidates(
  settings: Pick<ContextManagementSettings, 'summaryModel'>,
  run: SummarizationCandidate
): Promise<SummarizationCandidate[]> {
  const out: SummarizationCandidate[] = [];
  const seen = new Set<string>();

  if (settings.summaryModel) {
    tryAddCandidate(out, seen, settings.summaryModel);
  }
  tryAddCandidate(out, seen, run);

  const providerIds = new Set(out.map((c) => c.providerId));
  providerIds.add(run.providerId.trim());

  for (const providerId of providerIds) {
    if (out.length >= MAX_SUMMARIZATION_CANDIDATES) break;
    const provider = await getProviderWithKey(providerId);
    if (!provider?.enabled) continue;
    for (const model of provider.models ?? []) {
      if (out.length >= MAX_SUMMARIZATION_CANDIDATES) break;
      tryAddCandidate(out, seen, { providerId, modelId: model.id });
    }
  }

  return out;
}

export interface SummarizeHistoryOpts {
  history: readonly ChatMessage[];
  candidates: readonly SummarizationCandidate[];
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
  providerId: string;
  modelId: string;
}

export interface SummarizeHistoryOutcome {
  result: SummarizeHistoryResult | null;
  /** Last model error when every candidate failed. */
  failureMessage?: string;
}

function formatSummarizationError(err: unknown): string {
  return isProviderError(err)
    ? err.friendlyMessage
    : err instanceof Error
      ? err.message
      : String(err);
}

/**
 * Summarize `history` into a structured block and persist the full transcript.
 * Returns `result: null` (caller keeps the raw history) when there is nothing
 * meaningful to summarize or every model candidate fails — summarization must
 * never destroy context it could not replace.
 */
export async function summarizeHistory(
  opts: SummarizeHistoryOpts
): Promise<SummarizeHistoryOutcome> {
  const transcript = redactUserHomeInText(serializeHistoryTranscript(opts.history));
  if (transcript.trim().length === 0) return { result: null };

  if (opts.candidates.length === 0) {
    return {
      result: null,
      failureMessage:
        'No summarization model is available. Pick a different model or configure one under Settings → Agent behavior → Context management.'
    };
  }

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
    return { result: null };
  }

  let lastFailure: string | undefined;
  for (const candidate of opts.candidates) {
    let summary = '';
    try {
      const stream = streamChat({
        providerId: candidate.providerId,
        model: candidate.modelId,
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
      const msg = formatSummarizationError(err);
      lastFailure = msg;
      if (isProviderError(err) && err.kind === 'billing') {
        setRecentBillingBlock(candidate, msg);
      }
      log.warn('summarization model call failed — trying next candidate', {
        runId: opts.runId,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        err: msg
      });
      continue;
    }

    if (summary.trim().length === 0) {
      lastFailure = 'Summarization produced empty output.';
      log.warn('summarization produced empty output — trying next candidate', {
        runId: opts.runId,
        providerId: candidate.providerId,
        modelId: candidate.modelId
      });
      continue;
    }

    return {
      result: {
        summary: summary.trim(),
        relativePath,
        originalChars: transcript.length,
        originalMessages: opts.history.length,
        providerId: candidate.providerId,
        modelId: candidate.modelId
      }
    };
  }

  await removeSummaryArtifact(opts.workspacePath, relativePath);
  log.warn('summarization failed for all candidates — keeping raw history', {
    runId: opts.runId,
    candidates: opts.candidates.length,
    err: lastFailure
  });
  return {
    result: null,
    failureMessage:
      lastFailure ??
      'Summarization failed. Configure a summary model under Settings → Agent behavior → Context management.'
  };
}
