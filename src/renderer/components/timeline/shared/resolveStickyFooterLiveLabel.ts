/**
 * Context-aware label for the live sticky turn footer.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { ToolName } from '@shared/types/tool.js';
import type { LiveRunActivity } from './detectLiveRunActivity.js';

type RunStatusEvent = Extract<TimelineEvent, { kind: 'run-status' }>;

export interface StickyFooterLiveContext {
  awaitingAskUser: boolean;
  latestStatus?: RunStatusEvent;
  activity?: LiveRunActivity;
  fileEditCount: number;
  elapsedMs: number;
  tokenLabel: string | null;
}

export function resolveStickyFooterLiveLabel(ctx: StickyFooterLiveContext): {
  headline: string;
  detailParts: string[];
} {
  if (ctx.awaitingAskUser) {
    const parts = [formatElapsed(ctx.elapsedMs)];
    if (ctx.tokenLabel) parts.push(ctx.tokenLabel);
    return { headline: 'Awaiting your answer', detailParts: parts };
  }

  const headline = resolveHeadline(ctx.latestStatus, ctx.activity);
  const detailParts = [formatElapsed(ctx.elapsedMs)];
  if (ctx.tokenLabel) detailParts.push(ctx.tokenLabel);
  if (ctx.fileEditCount > 0) {
    detailParts.push(`${ctx.fileEditCount} edit${ctx.fileEditCount === 1 ? '' : 's'}`);
  }

  return { headline, detailParts };
}

function resolveHeadline(
  latest: RunStatusEvent | undefined,
  activity: LiveRunActivity | undefined
): string {
  const act = activity ?? {};

  if (act.streamingReasoning) return 'Thinking';
  if (act.streamingText) return 'Writing';

  const streamingTool = act.streamingToolName ?? act.activeToolName;
  if (streamingTool) {
    return toolHeadline(streamingTool) ?? 'Exploring';
  }

  if (latest?.phase === 'running-tool') {
    const toolName = latest.detail?.toolName as ToolName | undefined;
    return toolHeadline(toolName) ?? 'Exploring';
  }

  if (latest) {
    const fromLabel = headlineFromRunStatusLabel(latest);
    if (fromLabel) return fromLabel;
  }

  return 'Running';
}

function headlineFromRunStatusLabel(latest: RunStatusEvent): string | null {
  const phase = latest.phase;
  const label = latest.label?.trim() ?? '';

  if (phase === 'preparing-turn') {
    return label.replace(/…+$/, '').trim() || 'Preparing next turn';
  }
  if (phase === 'connecting') {
    if (label.length > 0) return label.replace(/…+$/, '').trim();
    return 'Connecting';
  }
  if (phase === 'awaiting-response') {
    return 'Waiting for model';
  }
  if (phase === 'retrying') {
    return label.replace(/…+$/, '').trim() || 'Retrying';
  }
  if (phase === 'nudging') {
    return label.replace(/…+$/, '').trim() || 'Continuing';
  }

  const lower = label.toLowerCase();
  if (lower.includes('reason')) return 'Thinking';
  if (lower.includes('stream') || lower.includes('writ')) return 'Writing';

  if (label.length > 0) return label.replace(/…+$/, '').trim();
  return null;
}

function toolHeadline(toolName: ToolName | undefined): string | null {
  switch (toolName) {
    case 'read':
      return 'Reading';
    case 'bash':
      return 'Running command';
    case 'edit':
      return 'Editing';
    case 'search':
      return 'Searching';
    case 'sg':
      return 'Running sg';
    case 'ls':
      return 'Listing';
    case 'delete':
      return 'Deleting';
    case 'memory':
      return 'Updating memory';
    case 'recall':
      return 'Recalling context';
    case 'report':
      return 'Writing report';
    case 'ask_user':
      return null;
    case 'finish':
      return null;
    default:
      return null;
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
