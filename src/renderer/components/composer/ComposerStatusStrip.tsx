/**
 * Composer hint strip — ask-user reply, mid-run Send/Queue guidance, and balance.
 * Prompt-cache stats live in {@link ComposerCacheStatPill} (metrics row).
 */

import { memo } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PendingAskUserEvent } from '../../lib/pendingAskUser.js';
import {
  formatProviderAccountLine,
  isProviderAccountLow
} from '../../lib/formatProviderAccount.js';
import { useProviderAccountStore } from '../../store/useProviderAccountStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { cn } from '../../lib/cn.js';
import { COMPOSER_PROCESSING_RUN_HINT } from './composerPlaceholder.js';

interface ComposerStatusStripProps {
  pendingAskUser?: PendingAskUserEvent | null;
  model?: ModelSelection | null;
  /** Mid-run steering / queue guidance for the chip row. */
  processingRun?: boolean;
  /** Images attached but selected model lacks vision. */
  visionWarning?: boolean;
}

export const ComposerStatusStrip = memo(function ComposerStatusStrip({
  pendingAskUser = null,
  model = null,
  processingRun = false,
  visionWarning = false
}: ComposerStatusStripProps) {
  const account = useProviderAccountStore((s) =>
    model ? s.snapshotFor(model.providerId) : undefined
  );
  const accountLine = formatProviderAccountLine(account);
  const lowBalance = isProviderAccountLow(account);
  const toolCacheHint = useChatStore((s) => s.toolCacheHint);

  if (pendingAskUser) {
    const isHostGate = pendingAskUser.source === 'host-report-gate';
    const title =
      pendingAskUser.payload.title?.trim() || 'Clarifying questions';
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-text-secondary"
        role="status"
        aria-live="polite"
      >
        <span className="font-medium text-accent">Reply needed</span>
        {' — '}
        {isHostGate
          ? 'Answer in the prompt below, or type here and press Send'
          : `Answer in ${title === 'Clarifying questions' ? 'the card above' : `"${title}"`}, or type below and press Send`}
      </span>
    );
  }

  if (toolCacheHint) {
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 font-mono text-meta text-text-faint"
        role="status"
        aria-live="polite"
      >
        {toolCacheHint}
      </span>
    );
  }

  if (visionWarning) {
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-warning"
        role="status"
        aria-live="polite"
        title="Images will be sent as path references only — pick a vision-capable model to analyze pixels"
      >
        Model may not support vision — images sent as references only
      </span>
    );
  }

  if (processingRun) {
    return (
      <span
        className="vx-composer-status-strip vx-composer-status-strip--run-hint min-w-0 flex-1 truncate px-0.5 text-meta text-text-faint"
        role="status"
        aria-live="polite"
        title={COMPOSER_PROCESSING_RUN_HINT}
      >
        <span className="vx-composer-run-hint-primary">Send steers mid-run</span>
        <span className="vx-composer-run-hint-secondary"> · Queue before finish</span>
      </span>
    );
  }

  if (!accountLine) return null;

  return (
    <span
      className={cn(
        'vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 font-mono text-meta tabular-nums',
        lowBalance ? 'text-warning' : 'text-text-faint'
      )}
      role="status"
      aria-live="polite"
      title={lowBalance ? 'Provider balance is low — top up or switch models' : undefined}
    >
      {lowBalance ? <span className="font-medium text-warning">Low balance</span> : null}
      {lowBalance ? ' · ' : null}
      {accountLine}
    </span>
  );
});
