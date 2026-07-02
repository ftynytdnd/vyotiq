/**
 * Composer hint strip — ask-user reply, mid-run Send/Queue guidance, and balance.
 * Prompt-cache stats live in {@link ComposerCacheStatPill} (metrics row).
 */

import { memo, type ReactNode } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import {
  ASK_USER_REPLY_NEEDED,
  resolveAskUserStatusDetail
} from '@shared/askUser/askUserCopy.js';
import type { PendingAskUserEvent } from '../../lib/pendingAskUser.js';
import {
  formatComposerAccountLine,
  isProviderAccountLow
} from '../../lib/formatProviderAccount.js';
import { useProviderAccountStore } from '../../store/useProviderAccountStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useAppViewStore } from '../../store/useAppViewStore.js';
import { authoringModelDiffersFrom, formatAuthoringModelHint } from '../../lib/authoringModelHint.js';
import { ComposerProxyStatusStrip, shouldShowComposerProxyBanner } from './ComposerProxyStatusStrip.js';
import { ComposerBranchChip } from './branchPicker/ComposerBranchChip.js';
import { useChatStore } from '../../store/useChatStore.js';
import { cn } from '../../lib/cn.js';
import { COMPOSER_PROCESSING_RUN_HINT } from './composerPlaceholder.js';

interface ComposerStatusStripProps {
  workspaceId?: string | null;
  pendingAskUser?: PendingAskUserEvent | null;
  model?: ModelSelection | null;
  /** Mid-run steering / queue guidance for the chip row. */
  processingRun?: boolean;
  /** Active `/skill-name` slash token in the composer draft. */
  invokedSkillDraft?: string | null;
  /** Images attached but selected model lacks vision. */
  visionWarning?: boolean;
  /** PDF attached but selected model lacks native PDF input. */
  pdfWarning?: boolean;
  /** Video attached but selected model lacks native video input. */
  videoWarning?: boolean;
  /** Audio attached but selected model lacks native audio input. */
  audioWarning?: boolean;
}

function StatusStripWithBranch({
  workspaceId,
  className,
  title,
  children
}: {
  workspaceId: string | null;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'vx-composer-status-strip flex min-w-0 flex-1 items-center gap-1 truncate px-0.5',
        className
      )}
      role="status"
      aria-live="polite"
      title={title}
    >
      <ComposerBranchChip workspaceId={workspaceId} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </span>
  );
}

export const ComposerStatusStrip = memo(function ComposerStatusStrip({
  workspaceId = null,
  pendingAskUser = null,
  model = null,
  processingRun = false,
  invokedSkillDraft = null,
  visionWarning = false,
  pdfWarning = false,
  videoWarning = false,
  audioWarning = false
}: ComposerStatusStripProps) {
  const account = useProviderAccountStore((s) =>
    model ? s.snapshotFor(model.providerId) : undefined
  );
  const providers = useProviderStore((s) => s.providers);
  const selectedProvider = model ? providers.find((p) => p.id === model.providerId) : undefined;

  const accountLine = formatComposerAccountLine(account);
  const lowBalance = isProviderAccountLow(account);
  const toolCacheHint = useChatStore((s) => s.toolCacheHint);
  const authoringModel = useSettingsStore((s) => s.settings.authoringModel);
  const settingsOpen = useAppViewStore((s) => s.view === 'settings');
  const agentBehaviorSection = useSettingsStore((s) => s.settings.ui?.lastAgentBehaviorSection);
  const showAuthoringHint =
    settingsOpen &&
    (agentBehaviorSection === 'harness' || agentBehaviorSection === 'skills') &&
    authoringModel &&
    authoringModelDiffersFrom(authoringModel, model);

  if (pendingAskUser) {
    const detail = resolveAskUserStatusDetail({
      payload: pendingAskUser.payload,
      ...(pendingAskUser.source ? { source: pendingAskUser.source } : {})
    });
    return (
      <StatusStripWithBranch workspaceId={workspaceId} className="text-chat-meta text-text-secondary">
        <span className="font-medium text-accent">{ASK_USER_REPLY_NEEDED}</span>
        {detail ? (
          <>
            {' — '}
            {detail}
          </>
        ) : null}
      </StatusStripWithBranch>
    );
  }

  if (toolCacheHint) {
    return (
      <StatusStripWithBranch
        workspaceId={workspaceId}
        className="font-mono text-chat-meta text-text-faint"
      >
        {toolCacheHint}
      </StatusStripWithBranch>
    );
  }

  if (visionWarning) {
    return (
      <StatusStripWithBranch
        workspaceId={workspaceId}
        className="text-chat-meta text-warning"
        title="Images will be sent as path references only — pick a vision-capable model to analyze pixels"
      >
        Model may not support vision — images sent as references only
      </StatusStripWithBranch>
    );
  }

  if (pdfWarning) {
    return (
      <StatusStripWithBranch
        workspaceId={workspaceId}
        className="text-chat-meta text-warning"
        title="PDF will be sent as a path reference only — pick a model with native PDF input"
      >
        Model may not support PDF — file sent as reference only
      </StatusStripWithBranch>
    );
  }

  if (videoWarning) {
    return (
      <StatusStripWithBranch
        workspaceId={workspaceId}
        className="text-chat-meta text-warning"
        title="Video will be sent as a path reference only — pick a model with native video input"
      >
        Model may not support video — file sent as reference only
      </StatusStripWithBranch>
    );
  }

  if (audioWarning) {
    return (
      <StatusStripWithBranch
        workspaceId={workspaceId}
        className="text-chat-meta text-warning"
        title="Audio will be sent as path references only — pick an audio-capable model"
      >
        Model may not support audio — file sent as reference only
      </StatusStripWithBranch>
    );
  }

  if (invokedSkillDraft) {
    return (
      <StatusStripWithBranch workspaceId={workspaceId} className="text-chat-meta text-text-secondary">
        Skill <span className="font-medium text-accent">/{invokedSkillDraft}</span> will load on send
      </StatusStripWithBranch>
    );
  }

  if (processingRun) {
    return (
      <StatusStripWithBranch
        workspaceId={workspaceId}
        className="vx-composer-status-strip--run-hint text-chat-meta text-text-faint"
        title={COMPOSER_PROCESSING_RUN_HINT}
      >
        <span className="vx-composer-run-hint-primary">Send steers mid-run</span>
        <span className="vx-composer-run-hint-secondary"> · Queue before finish</span>
      </StatusStripWithBranch>
    );
  }

  if (model && shouldShowComposerProxyBanner(model, selectedProvider, account)) {
    return (
      <div className="vx-composer-status-strip flex min-w-0 flex-1 items-center gap-1 px-0.5">
        <ComposerBranchChip workspaceId={workspaceId} />
        <ComposerProxyStatusStrip model={model} />
      </div>
    );
  }

  if (showAuthoringHint && authoringModel) {
    return (
      <StatusStripWithBranch
        workspaceId={workspaceId}
        className="text-chat-meta text-text-secondary"
        title={formatAuthoringModelHint(authoringModel)}
      >
        {formatAuthoringModelHint(authoringModel)}
      </StatusStripWithBranch>
    );
  }

  if (!accountLine) {
    return <ComposerBranchChip workspaceId={workspaceId} />;
  }

  return (
    <span
      className={cn(
        'vx-composer-status-strip flex min-w-0 flex-1 items-center gap-1 truncate px-0.5 font-mono text-chat-meta tabular-nums',
        lowBalance ? 'text-warning' : 'text-text-faint'
      )}
      role="status"
      aria-live="polite"
      title={lowBalance ? 'Provider balance is low — top up or switch models' : undefined}
    >
      <ComposerBranchChip workspaceId={workspaceId} />
      {lowBalance ? <span className="font-medium text-warning">Low balance</span> : null}
      {lowBalance ? ' · ' : null}
      {accountLine}
    </span>
  );
});
