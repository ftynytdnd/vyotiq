/**
 * Full trace body for one sub-agent snapshot — salvaged from the inline
 * sub-agent detail tabs: briefing scope, chronological run flow, and
 * structured result envelope.
 */

import { useMemo } from 'react';
import type { SubAgentSnapshot } from '../timeline/reducer/types.js';
import { SubAgentRunFlow } from './trace/SubAgentRunFlow.js';
import { SubAgentResult } from './trace/SubAgentResult.js';
import { SubAgentBriefing } from './trace/briefing/SubAgentBriefing.js';
import { SubAgentActions } from './trace/SubAgentActions.js';
import { resolveSubAgentSubtitle } from './trace/subtitleResolver.js';
import { timelineSubAgentDotClassName } from '../timeline/shared/rowStyles.js';
import { cn } from '../../lib/cn.js';
import { displayAssistantTurnText } from '../../lib/text.js';
import { sanitizeTraceTitle } from '../../lib/traceSanitize.js';
import { parseResultEnvelope } from '@shared/text/resultPatterns.js';

interface AgentTraceContentProps {
  snap: SubAgentSnapshot;
}

function structuralVerdictHint(
  verdict: SubAgentSnapshot['structuralVerdict'] | undefined
): string | null {
  switch (verdict) {
    case 'ok':
      return 'Host structural check: envelope OK (orchestrator still verifies semantics).';
    case 'malformed':
      return 'Host structural check: malformed or missing <result> envelope.';
    case 'self-failed':
      return 'Host structural check: worker reported <status>failed</status>.';
    default:
      return null;
  }
}

function statusLabel(status: SubAgentSnapshot['status']): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'done':
      return 'Done';
    case 'partial':
      return 'Partial';
    case 'failed':
      return 'Failed';
    case 'malformed':
      return 'Malformed';
    case 'aborted':
      return 'Aborted';
    default:
      return status;
  }
}

function normalizeComparable(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function outputDuplicatesAssistant(snap: SubAgentSnapshot): boolean {
  const raw = snap.output?.trim() ?? '';
  if (!raw) return false;

  const parsed = parseResultEnvelope(raw);
  const resultText = parsed.found
    ? (parsed.summary || parsed.inner).trim()
    : raw;
  if (!resultText) return false;

  const normResult = normalizeComparable(resultText);
  for (const id of snap.iterationOrder) {
    const acc = snap.assistantTexts[id];
    if (!acc?.text.trim()) continue;
    const cleaned = displayAssistantTurnText(acc.text);
    const normAssistant = normalizeComparable(cleaned);
    if (!normAssistant) continue;
    if (normAssistant === normResult) return true;
    if (
      normResult.length >= 48 &&
      (normAssistant.includes(normResult) || normResult.includes(normAssistant))
    ) {
      return true;
    }
  }
  return false;
}

export function AgentTraceContent({ snap }: AgentTraceContentProps) {
  const running = snap.status === 'pending' || snap.status === 'running';
  const taskLabel = sanitizeTraceTitle(snap.task);
  const subtitle = resolveSubAgentSubtitle(snap);
  const touchedFiles = useMemo(
    () => [...new Set(snap.fileEdits.map((f) => f.filePath))],
    [snap.fileEdits]
  );

  const hideResult = outputDuplicatesAssistant(snap);
  const hasOutput = typeof snap.output === 'string' && snap.output.trim().length > 0;
  const showResult =
    hasOutput &&
    !hideResult &&
    (snap.status === 'done' ||
      snap.status === 'partial' ||
      snap.status === 'failed' ||
      snap.status === 'malformed');

  const hasFlow =
    snap.steps.length > 0 ||
    snap.iterationOrder.length > 0 ||
    Object.keys(snap.partialToolCallArgs).length > 0;

  const structuralHint = structuralVerdictHint(snap.structuralVerdict);

  return (
    <div className="flex min-h-0 flex-col gap-3 p-3">
      <header className="flex flex-col gap-1.5 border-b border-border-subtle/20 pb-3">
        <div className="flex items-start gap-2">
          <span className={timelineSubAgentDotClassName(running)} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-row font-medium text-text-primary">{statusLabel(snap.status)}</div>
              <SubAgentActions output={snap.output} touchedFiles={touchedFiles} />
            </div>
            {(subtitle || (snap.liveStatus?.label && running)) && (
              <div className="mt-0.5 text-meta text-text-muted">
                {subtitle ?? snap.liveStatus?.label}
              </div>
            )}
            {structuralHint && !running && (
              <div className="mt-0.5 text-meta text-text-faint">{structuralHint}</div>
            )}
            {taskLabel && <p className="mt-1 text-row text-text-secondary">{taskLabel}</p>}
            {snap.model && (
              <p className="mt-1 font-mono text-meta text-text-faint">
                {snap.model.providerId} · {snap.model.modelId}
              </p>
            )}
          </div>
        </div>
        {snap.message && (
          <p className="text-meta text-danger">{sanitizeTraceTitle(snap.message)}</p>
        )}
      </header>

      <SubAgentBriefing snap={snap} />

      {hasFlow && (
        <section>
          <div className="text-meta uppercase tracking-wide text-text-faint">Run</div>
          <div className="mt-2">
            <SubAgentRunFlow snap={snap} />
          </div>
        </section>
      )}

      {showResult && (
        <section>
          <div className="text-meta uppercase tracking-wide text-text-faint">Result</div>
          <div className="mt-2">
            <SubAgentResult output={snap.output!} />
          </div>
        </section>
      )}

      {!running && !hasFlow && !showResult && (
        <p className={cn('text-row text-text-muted')}>No trace output yet.</p>
      )}
    </div>
  );
}
