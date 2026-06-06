/**
 * Trailing run closer — quiet flush log line (no horizontal rules).
 */

import { useCallback, useMemo, useState } from 'react';
import { formatTokenCountWithUnit } from '../../../lib/formatTokens.js';
import type { TokenUsageAggregate } from '../reducer/types.js';
import { cn } from '../../../lib/cn.js';
import {
  timelineActionPillPrimaryClassName,
  timelineActionPillSecondaryClassName,
  timelineReportOfferClassName,
  timelineRunCompleteRowClassName
} from '../shared/rowStyles.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { selectEffectivePermissions, useSettingsStore } from '../../../store/useSettingsStore.js';
import { vyotiq } from '../../../lib/ipc.js';
import { openWorkspaceFile } from '../../../lib/openPath.js';
import { AI_RUN_SUMMARY_USER_PROMPT } from '@shared/report/deliverables.js';
import { resolveReportsSettings } from '@shared/report/reportsSettings.js';
import {
  buildRunSummaryInput,
  runHadReport,
  shouldOfferRunSummary
} from '../../../lib/runSummaryOffer.js';

interface RunCompleteRowProps {
  promptId: string;
  durationMs: number;
  completedAt: number;
  usage?: TokenUsageAggregate;
  editCount?: number;
  fileCount?: number;
}

/** Turns at or above this duration get a warning tone on the elapsed label. */
const LONG_TURN_WARN_MS = 120_000;

/** Turns at or above this duration get a stronger warning + tooltip. */
const VERY_LONG_TURN_WARN_MS = 480_000;

export function RunCompleteRow({
  promptId,
  durationMs,
  completedAt,
  usage,
  editCount,
  fileCount
}: RunCompleteRowProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const events = useChatStore((s) => s.events);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const send = useChatStore((s) => s.send);
  const showToast = useToastStore((s) => s.show);
  const settings = useSettingsStore((s) => s.settings);
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
  }, [
    completedAt,
    conversationId,
    durationMs,
    editCount,
    events,
    fileCount,
    promptId,
    workspaceId
  ]);

  const hadReport = useMemo(
    () => runHadReport(events, promptId, completedAt),
    [completedAt, events, promptId]
  );

  const onGenerateSummary = useCallback(async () => {
    if (!conversationId || !workspaceId || generating) return;
    const input = buildRunSummaryInput({
      conversationId,
      workspaceId,
      promptId,
      durationMs,
      completedAt,
      editCount,
      fileCount,
      events
    });
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
    durationMs,
    editCount,
    events,
    fileCount,
    generating,
    promptId,
    reports.autoOpenReports,
    showToast,
    workspaceId
  ]);

  const onAiReport = useCallback(() => {
    if (isProcessing || hadReport) return;
    const model =
      conversationMeta?.lastProviderId && conversationMeta.lastModelId
        ? {
            providerId: conversationMeta.lastProviderId,
            modelId: conversationMeta.lastModelId
          }
        : settings.defaultModel ?? null;
    if (!model) {
      showToast('Select a model before requesting an AI report.', 'danger');
      return;
    }
    const permissions = selectEffectivePermissions(workspaceId, settings);
    void send(AI_RUN_SUMMARY_USER_PROMPT, model, permissions);
  }, [
    conversationMeta?.lastModelId,
    conversationMeta?.lastProviderId,
    hadReport,
    isProcessing,
    send,
    settings,
    showToast,
    workspaceId
  ]);

  const tokenLabel =
    usage && usage.cumulative.totalTokens > 0
      ? formatTokenCountWithUnit(usage.cumulative.totalTokens)
      : null;

  const stats: string[] = [];
  if (typeof editCount === 'number' && editCount > 0) {
    stats.push(`${editCount} edit${editCount === 1 ? '' : 's'}`);
  }
  if (typeof fileCount === 'number' && fileCount > 0) {
    stats.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
  }

  const durationLabel = formatDuration(durationMs);
  const timeLabel = formatWallClock(completedAt);
  const tokenTitle = tokenLabel ? `${tokenLabel} used this turn` : null;
  const veryLongTurn = durationMs >= VERY_LONG_TURN_WARN_MS;
  const longTurn = durationMs >= LONG_TURN_WARN_MS;
  const durationTitle = veryLongTurn
    ? 'This turn took unusually long — often approval waits or connection delays.'
    : longTurn
      ? 'This turn took longer than usual.'
      : undefined;
  const metaParts: string[] = [`done in ${durationLabel}`];
  if (tokenLabel) metaParts.push(tokenLabel);
  metaParts.push(timeLabel);
  if (stats.length > 0) metaParts.unshift(stats.join(' · '));
  const ariaLabel = metaParts.join(' · ');

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'vyotiq-stepfade-once vx-timeline-meta text-text-secondary',
          timelineRunCompleteRowClassName
        )}
        data-row-kind="run-complete"
        aria-label={ariaLabel}
      >
        {stats.length > 0 ? (
          <>
            <span>{stats.join(' · ')}</span>
            <span aria-hidden className="text-text-faint/70">
              {' · '}
            </span>
          </>
        ) : null}
        <span>
          done in{' '}
          <span
            className={cn(
              veryLongTurn && 'text-warning',
              !veryLongTurn && longTurn && 'text-text-faint'
            )}
            title={durationTitle}
          >
            {durationLabel}
          </span>
        </span>
        {tokenLabel !== null ? (
          <>
            <span aria-hidden className="text-text-faint/70">
              {' · '}
            </span>
            <span className="font-mono tabular-nums" title={tokenTitle ?? undefined}>
              {tokenLabel}
            </span>
          </>
        ) : null}
        <span aria-hidden className="text-text-faint/70">
          {' · '}
        </span>
        <time dateTime={new Date(completedAt).toISOString()} className="tabular-nums text-text-faint">
          {timeLabel}
        </time>
      </div>
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

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - totalMinutes * 60);
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - hours * 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatWallClock(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return d.toLocaleString(undefined, {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit'
  });
}
