/**
 * Composer hint strip — ask-user reply, mid-run Send/Queue guidance, and balance.
 * Prompt-cache stats live in {@link ComposerCacheStatPill} (metrics row).
 */

import { memo } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import {
  ASK_USER_REPLY_NEEDED,
  resolveAskUserStatusDetail
} from '@shared/askUser/askUserCopy.js';
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
  /** PDF attached but selected model lacks native PDF input. */
  pdfWarning?: boolean;
  /** Video attached but selected model lacks native video input. */
  videoWarning?: boolean;
  /** Audio attached but selected model lacks native audio input. */
  audioWarning?: boolean;
}

export const ComposerStatusStrip = memo(function ComposerStatusStrip({
  pendingAskUser = null,
  model = null,
  processingRun = false,
  visionWarning = false,
  pdfWarning = false,
  videoWarning = false,
  audioWarning = false
}: ComposerStatusStripProps) {
  const account = useProviderAccountStore((s) =>
    model ? s.snapshotFor(model.providerId) : undefined
  );
  const accountLine = formatProviderAccountLine(account);
  const lowBalance = isProviderAccountLow(account);
  const toolCacheHint = useChatStore((s) => s.toolCacheHint);

  if (pendingAskUser) {
    const detail = resolveAskUserStatusDetail({
      payload: pendingAskUser.payload,
      ...(pendingAskUser.source ? { source: pendingAskUser.source } : {})
    });
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-text-secondary"
        role="status"
        aria-live="polite"
      >
        <span className="font-medium text-accent">{ASK_USER_REPLY_NEEDED}</span>
        {detail ? (
          <>
            {' — '}
            {detail}
          </>
        ) : null}
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

  if (pdfWarning) {
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-warning"
        role="status"
        aria-live="polite"
        title="PDF will be sent as a path reference only — pick a model with native PDF input"
      >
        Model may not support PDF — file sent as reference only
      </span>
    );
  }

  if (videoWarning) {
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-warning"
        role="status"
        aria-live="polite"
        title="Video will be sent as a path reference only — pick a model with native video input"
      >
        Model may not support video — file sent as reference only
      </span>
    );
  }

  if (audioWarning) {
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-warning"
        role="status"
        aria-live="polite"
        title="Audio will be sent as path references only — pick an audio-capable model"
      >
        Model may not support audio — file sent as reference only
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
