/** Expanded delegation trace panel. */

import { useMemo } from 'react';
import type { SubAgentSnapshot } from '../reducer/types.js';
import { SubAgentRunFlow } from '../../agent/trace/SubAgentRunFlow.js';
import { SubAgentResult } from '../../agent/trace/SubAgentResult.js';
import { SubAgentActions } from '../../agent/trace/SubAgentActions.js';
import { displayAssistantTurnText } from '../../../lib/text.js';
import { parseResultEnvelope } from '@shared/text/resultPatterns.js';
import { cn } from '../../../lib/cn.js';

interface DelegationLabPanelProps {
  snap: SubAgentSnapshot;
}

function outputDuplicatesAssistant(snap: SubAgentSnapshot): boolean {
  const raw = snap.output?.trim() ?? '';
  if (!raw) return false;
  const parsed = parseResultEnvelope(raw);
  const resultText = parsed.found ? (parsed.summary || parsed.inner).trim() : raw;
  if (!resultText) return false;
  const normResult = resultText.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const id of snap.iterationOrder) {
    const acc = snap.assistantTexts[id];
    if (!acc?.text.trim()) continue;
    const normAssistant = displayAssistantTurnText(acc.text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!normAssistant) continue;
    if (normAssistant === normResult) return true;
  }
  return false;
}

export function DelegationLabPanel({ snap }: DelegationLabPanelProps) {
  const running = snap.status === 'pending' || snap.status === 'running';
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

  return (
    <div className={cn('vx-timeline-deleg-lab flex flex-col gap-2 border-t border-border-subtle/20 pt-2')}>
      <div className="flex flex-wrap items-center gap-2">
        <SubAgentActions output={snap.output} touchedFiles={touchedFiles} />
      </div>
      {snap.message ? (
        <p className="text-meta text-danger">{snap.message}</p>
      ) : null}
      {hasFlow && !running && (
        <SubAgentRunFlow snap={snap} />
      )}
      {showResult && <SubAgentResult output={snap.output!} />}
      {!running && !hasFlow && !showResult && (
        <p className="text-meta text-text-faint">No additional lab detail.</p>
      )}
    </div>
  );
}
