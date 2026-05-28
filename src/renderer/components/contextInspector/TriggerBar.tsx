/**
 * Bottom action bar for the Context Inspector.
 *
 * Visual contract: Vyotiq UI action row — `vx-field-label`, `vx-row-desc`,
 * `vx-action-row`, and `vx-btn` actions (matches Settings specimen).
 */

import { Layers, RotateCcw, Sparkles, Square, XCircle } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { projectAfterTokens, sumTokens } from './inspectorFormat.js';
import { ShellActionRow, ShellCaption } from '../ui/ShellSection.js';
import { chromeBadgeClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import type {
  ContextInspectorSnapshot,
  ContextSummaryRules
} from '@shared/types/contextSummary.js';

interface TriggerBarProps {
  snapshot: ContextInspectorSnapshot;
  rules: ContextSummaryRules;
}

export function TriggerBar({ snapshot, rules }: TriggerBarProps) {
  const triggerManual = useContextSummaryStore((s) => s.triggerManual);
  const abortIdle = useContextSummaryStore((s) => s.abortIdle);
  const abortLiveSummary = useContextSummaryStore((s) => s.abortLiveSummary);
  const inspectorMode = useContextSummaryStore((s) => s.mode);
  const boundId = useContextSummaryStore((s) => s.boundId);
  const resetOverrides = useContextSummaryStore((s) => s.resetMessageOverrides);
  const busy = useContextSummaryStore((s) => s.busy);
  const abortRun = useChatStore((s) => s.abortRun);
  const showToast = useToastStore((s) => s.show);

  const summarizableTokens = sumTokens(
    snapshot.messages,
    (m) => m.effectiveDecision === 'summarize'
  );
  const summarizableCount = snapshot.messages.filter(
    (m) => m.effectiveDecision === 'summarize'
  ).length;
  const projectedAfter = projectAfterTokens(snapshot.messages);

  const summaryInFlight = snapshot.activeSummaryId !== undefined;
  const canTrigger =
    rules.enabled &&
    !summaryInFlight &&
    summarizableCount >= rules.minMessagesToSummarize;
  const triggerDisabledReason = (() => {
    if (!rules.enabled) return 'Context summarization is disabled in settings.';
    if (summaryInFlight) return 'A summarization is already in flight.';
    if (summarizableCount < rules.minMessagesToSummarize) {
      return `Need at least ${rules.minMessagesToSummarize} summarizable messages — only ${summarizableCount} ready.`;
    }
    return undefined;
  })();

  const onTrigger = async () => {
    const result = await triggerManual();
    if (!result.ok) {
      showToast(`Could not summarize: ${result.reason}`, 'danger');
      return;
    }
    showToast('Summarization started.', 'success');
  };

  const onCancelSummary = async () => {
    const result =
      inspectorMode === 'live' && boundId
        ? await abortLiveSummary()
        : await abortIdle();
    if (!result.ok) {
      showToast('No summarization is running.', 'danger');
      return;
    }
    showToast('Summarization cancelled.', 'success');
  };

  const onStopRun = async () => {
    if (inspectorMode !== 'live' || !boundId) return;
    await abortRun(boundId);
    showToast('Run stopped.', 'success');
  };

  const onReset = async () => {
    await resetOverrides(snapshot.conversationId);
    showToast('Cleared every per-message override on this conversation.', 'success');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="vx-field-label mb-0">Summarize now</span>
        <span className="font-mono text-row text-text-secondary">
          {formatTokenCount(summarizableTokens)} → ~{formatTokenCount(projectedAfter)} tok
        </span>
        {snapshot.workspaceOverridePresent && (
          <span
            className={cn(chromeBadgeClassName, 'ml-auto inline-flex items-center gap-1')}
            title="A workspace .vyotiq/context-summarizer.md is in effect. The bundled summarizer prompt is overridden for this workspace."
          >
            <Layers className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            Workspace override
          </span>
        )}
      </div>
      <ShellCaption>
        {triggerDisabledReason ??
          'Compresses the messages currently marked Summarize. The active rules above govern what gets included.'}
      </ShellCaption>
      <ShellActionRow className="pt-0">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void onReset()}
          title="Clear every Keep / Summarize / Drop override on this conversation."
        >
          <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          Reset overrides
        </Button>
        <Button
          size="sm"
          variant={canTrigger ? 'primary' : 'secondary'}
          disabled={!canTrigger}
          loading={busy && !summaryInFlight}
          onClick={() => void onTrigger()}
          title={triggerDisabledReason ?? 'Summarize the eligible messages now.'}
        >
          {!busy && <Sparkles className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          Summarize now
        </Button>
        {summaryInFlight && (
          <>
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => void onCancelSummary()}
              title="Stop only the in-flight context summarization."
            >
              {!busy && <XCircle className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
              Cancel summary
            </Button>
            {inspectorMode === 'live' && boundId && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void onStopRun()}
                title="Stop the entire orchestrator run."
              >
                <Square className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                Stop run
              </Button>
            )}
          </>
        )}
      </ShellActionRow>
    </div>
  );
}
