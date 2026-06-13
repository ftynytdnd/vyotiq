/**
 * Trailing run closer — quiet flush log line (no horizontal rules).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  timelineActionPillPrimaryClassName,
  timelineActionPillSecondaryClassName,
  timelineReportOfferClassName
} from '../shared/rowStyles.js';
import { RunCompleteMeta, type RunCompleteMetaProps } from './RunCompleteMeta.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { useSettingsStore } from '../../../store/useSettingsStore.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import {
  estimateRunCostBreakdown,
  estimateRunCostUsd,
  buildTurnUsageStatsDelta,
  recordRunSpendForPrompt,
  resolveModelForPrompt
} from '../../../lib/workspaceSpend.js';
import { vyotiq } from '../../../lib/ipc.js';
import { openWorkspaceFile } from '../../../lib/openPath.js';
import { AI_RUN_SUMMARY_USER_PROMPT } from '@shared/report/deliverables.js';
import { resolveReportsSettings } from '@shared/report/reportsSettings.js';
import {
  buildRunSummaryInput,
  runHadReport,
  shouldOfferRunSummary
} from '../../../lib/runSummaryOffer.js';

export type RunCompleteRowProps = RunCompleteMetaProps & {
  /** When true, metadata renders inline on the assistant row instead. */
  hideMeta?: boolean;
};

export function RunCompleteRow({
  hideMeta = false,
  ...metaProps
}: RunCompleteRowProps) {
  const { promptId, durationMs, completedAt, usage, editCount, fileCount } = metaProps;
  const conversationId = useChatStore((s) => s.conversationId);
  const events = useChatStore((s) => s.events);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const send = useChatStore((s) => s.send);
  const showToast = useToastStore((s) => s.show);
  const settings = useSettingsStore((s) => s.settings);
  const providers = useProviderStore((s) => s.providers);
  const reports = resolveReportsSettings(settings.ui);
  const conversationMeta = useConversationsStore((s) =>
    conversationId ? (s.list.find((m) => m.id === conversationId) ?? null) : null
  );
  const workspaceId = conversationMeta?.workspaceId ?? null;
  const [generating, setGenerating] = useState(false);

  const offerSummary = useMemo(() => {
    if (!conversationId || !workspaceId) return false;
    return shouldOfferRunSummary({
      promptId,
      completedAt,
      editCount,
      fileCount,
      events
    });
  }, [completedAt, conversationId, editCount, events, fileCount, promptId, workspaceId]);

  const hadReport = useMemo(
    () => runHadReport(events, promptId, completedAt),
    [completedAt, events, promptId]
  );

  const onGenerateSummary = useCallback(async () => {
    if (!conversationId || !workspaceId || generating) return;
    const input = buildRunSummaryInput(
      {
        conversationId,
        workspaceId,
        promptId,
        durationMs,
        completedAt,
        editCount,
        fileCount,
        events
      },
      providers,
      conversationMeta?.lastProviderId && conversationMeta?.lastModelId
        ? {
            providerId: conversationMeta.lastProviderId,
            modelId: conversationMeta.lastModelId
          }
        : null
    );
    if (!input) return;
    setGenerating(true);
    try {
      const reply = await vyotiq.tools.generateRunSummary(input);
      if (!reply.ok) {
        showToast(reply.error, 'danger');
        return;
      }
      showToast(`Report saved — ${reply.title}`, 'success');
      if (reports.autoOpenReports) {
        await openWorkspaceFile(reply.relPath, {
          workspaceId,
          kind: 'report',
          context: 'quick-summary',
          title: reply.title
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(message, 'danger');
    } finally {
      setGenerating(false);
    }
  }, [
    completedAt,
    conversationId,
    conversationMeta?.lastModelId,
    conversationMeta?.lastProviderId,
    durationMs,
    editCount,
    events,
    fileCount,
    generating,
    promptId,
    providers,
    reports.autoOpenReports,
    showToast,
    workspaceId
  ]);

  const onAiReport = useCallback(() => {
    if (isProcessing || hadReport) return;
    const model =
      resolveModelForPrompt(
        events,
        promptId,
        conversationMeta?.lastProviderId && conversationMeta?.lastModelId
          ? {
              providerId: conversationMeta.lastProviderId,
              modelId: conversationMeta.lastModelId
            }
          : null
      ) ??
      settings.defaultModel ??
      null;
    if (!model) {
      showToast('Select a model before requesting an AI report.', 'danger');
      return;
    }
    void send(AI_RUN_SUMMARY_USER_PROMPT, model);
  }, [
    conversationMeta?.lastModelId,
    conversationMeta?.lastProviderId,
    events,
    hadReport,
    isProcessing,
    promptId,
    send,
    settings,
    showToast,
    workspaceId
  ]);

  const modelForCost = resolveModelForPrompt(
    events,
    promptId,
    conversationMeta?.lastProviderId && conversationMeta?.lastModelId
      ? {
          providerId: conversationMeta.lastProviderId,
          modelId: conversationMeta.lastModelId
        }
      : null
  );
  const costUsd =
    usage && modelForCost ? estimateRunCostUsd(modelForCost, providers, usage.cumulative) : null;
  const costBreakdown =
    usage && modelForCost
      ? estimateRunCostBreakdown(modelForCost, providers, usage.cumulative)
      : null;

  const spendRecordedRef = useRef(false);
  useEffect(() => {
    if (spendRecordedRef.current || costUsd === null) return;
    if (!workspaceId && !conversationId) return;
    spendRecordedRef.current = true;
    const stats = usage
      ? buildTurnUsageStatsDelta(usage.cumulative, costBreakdown)
      : {};
    void recordRunSpendForPrompt(workspaceId, conversationId, promptId, costUsd, stats);
  }, [workspaceId, conversationId, costUsd, costBreakdown, promptId, usage]);

  if (hideMeta && !offerSummary) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {!hideMeta ? <RunCompleteMeta {...metaProps} /> : null}
      {offerSummary ? (
        <div className={timelineReportOfferClassName} data-report-offer>
          <p className="vx-report-offer__label">
            HTML report available — Quick summary is free; no tokens used.
          </p>
          <div className="vx-report-offer__actions">
            <button
              type="button"
              disabled={generating}
              onClick={() => void onGenerateSummary()}
              className={timelineActionPillPrimaryClassName}
              title="Generate a template HTML report instantly (no tokens)"
            >
              {generating ? 'Writing report…' : 'Quick summary'}
            </button>
            {reports.enableAiRunSummary ? (
              <button
                type="button"
                disabled={isProcessing || hadReport}
                onClick={onAiReport}
                className={timelineActionPillSecondaryClassName}
                title={
                  hadReport
                    ? 'A report was already generated for this run'
                    : isProcessing
                      ? 'Wait for the current run to finish'
                      : 'Start a new agent turn to author a full HTML report (uses tokens)'
                }
              >
                AI report
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { formatDuration, formatWallClock } from './runCompleteFormat.js';
