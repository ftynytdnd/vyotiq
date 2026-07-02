import { useEffect, useRef, useState } from 'react';
import { Pencil, Trash2, ArrowUp } from 'lucide-react';
import type { FollowUpMessage, FollowUpSource } from '@shared/types/followUp.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { defaultAttachmentPrompt } from '@shared/attachments/defaultAttachmentPrompt.js';
import { PromptAttachmentCards } from '../PromptAttachmentCards.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_CHROME_ICON_CLASS,
  SHELL_CHROME_ICON_STROKE,
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE
} from '../../../lib/shellIcons.js';

function sourceLabel(source: FollowUpSource): string {
  switch (source) {
    case 'scheduled':
      return 'scheduled';
    case 'heartbeat':
      return 'heartbeat';
    case 'continue':
      return 'continue';
    case 'dynamic-loop':
      return 'dynamic loop';
    case 'composer':
      return 'composer';
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

function FollowUpSourceBadge({ source }: { source: FollowUpSource }) {
  return (
    <span className="vx-composer-followup-source-badge" title={`Source: ${sourceLabel(source)}`}>
      {sourceLabel(source)}
    </span>
  );
}

function FollowUpModelChip({ selection }: { selection: ModelSelection }) {
  const label =
    selection.thinkingEffort != null
      ? `${selection.modelId} · ${selection.thinkingEffort}`
      : selection.modelId;
  return (
    <span className="vx-composer-followup-model-badge" title={`Model: ${label}`}>
      {label}
    </span>
  );
}

function FollowUpStaleBadge() {
  return (
    <span className="vx-composer-followup-stale-badge" title="Steering from a prior run — injects on next send">
      prior run
    </span>
  );
}

interface FollowUpRowBodyProps {
  item: FollowUpMessage;
  editing?: boolean;
  stale?: boolean;
}

function FollowUpRowBody({ item, editing = false, stale = false }: FollowUpRowBodyProps) {
  const promptText =
    item.prompt ||
    (item.attachmentMeta && item.attachmentMeta.length > 0
      ? defaultAttachmentPrompt(item.attachmentMeta)
      : 'See attached files.');
  return (
    <div className="vx-composer-followup-row__body min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <FollowUpSourceBadge source={item.source} />
        {item.invokedSkill ? (
          <span className="vx-composer-followup-source-badge" title={`Skill /${item.invokedSkill}`}>
            /{item.invokedSkill}
          </span>
        ) : null}
        <FollowUpModelChip selection={item.selection} />
        {stale ? <FollowUpStaleBadge /> : null}
        {editing ? (
          <span className="vx-composer-followup-editing-badge">editing</span>
        ) : null}
      </div>
      <p className="min-w-0 truncate text-row text-text-primary" title={promptText}>
        {promptText}
      </p>
      {item.attachmentMeta && item.attachmentMeta.length > 0 ? (
        <PromptAttachmentCards items={item.attachmentMeta} className="mt-0.5" />
      ) : null}
    </div>
  );
}

interface QueuedFollowUpListProps {
  items: FollowUpMessage[];
  editingQueuedId?: string | null;
  awaitingAskUser?: boolean;
  onEdit: (item: FollowUpMessage) => void;
  onRemove: (id: string) => void;
  onSendNow: (id: string) => void;
}

export function QueuedFollowUpList({
  items,
  editingQueuedId = null,
  awaitingAskUser = false,
  onEdit,
  onRemove,
  onSendNow
}: QueuedFollowUpListProps) {
  if (items.length === 0) return null;

  return (
    <div className="vx-composer-followup-section" data-testid="queued-follow-ups">
      <div className="vx-composer-followup-section__label">{items.length} Queued</div>
      <ul className="vx-composer-followup-list">
        {items.map((item) => {
          const isEditing = editingQueuedId === item.id;
          return (
            <li
              key={item.id}
              className={cn(
                'vx-composer-followup-row',
                isEditing && 'vx-composer-followup-row--editing'
              )}
            >
              <FollowUpRowBody item={item} editing={isEditing} />
              <div className="vx-composer-followup-row__actions shrink-0">
                <button
                  type="button"
                  className="vx-btn vx-btn-quiet h-6 w-6 px-0"
                  aria-label="Edit queued follow-up"
                  title="Edit"
                  onClick={() => onEdit(item)}
                >
                  <Pencil className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
                </button>
                <button
                  type="button"
                  className="vx-btn vx-btn-quiet h-6 w-6 px-0"
                  aria-label="Remove from queue"
                  title="Remove"
                  onClick={() => void onRemove(item.id)}
                >
                  <Trash2 className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
                </button>
                <button
                  type="button"
                  className={cn('vx-btn vx-btn-quiet h-6 px-2 text-meta', awaitingAskUser && 'opacity-50')}
                  aria-label="Send now"
                  title={
                    awaitingAskUser
                      ? 'Reply to clarifying questions before sending a queued follow-up'
                      : 'Send now'
                  }
                  disabled={awaitingAskUser}
                  onClick={() => void onSendNow(item.id)}
                >
                  Send now
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface SteeringFollowUpZoneProps {
  items: FollowUpMessage[];
  stale?: boolean;
  onRemove: (id: string) => void;
}

export function SteeringFollowUpZone({ items, stale = false, onRemove }: SteeringFollowUpZoneProps) {
  if (items.length === 0) return null;

  return (
    <div className="vx-composer-followup-section" data-testid="steering-follow-ups">
      <div className="vx-composer-followup-section__label">Send follow-up</div>
      <ul className="vx-composer-followup-list">
        {items.map((item) => (
          <li key={item.id} className="vx-composer-followup-row">
            <FollowUpRowBody item={item} stale={stale} />
            <div className="vx-composer-followup-row__actions shrink-0">
              <button
                type="button"
                className="vx-btn vx-btn-quiet h-6 w-6 px-0"
                aria-label="Remove follow-up"
                title="Remove"
                onClick={() => void onRemove(item.id)}
              >
                <Trash2 className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
              </button>
              <span className="flex h-6 w-6 items-center justify-center text-text-faint" aria-hidden>
                <ArrowUp className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildAriaLiveMessage(
  steering: FollowUpMessage[],
  queued: FollowUpMessage[],
  prevSteering: number,
  prevQueued: number
): string | null {
  const steerDelta = steering.length - prevSteering;
  const queueDelta = queued.length - prevQueued;
  const parts: string[] = [];
  if (steerDelta > 0) parts.push(`${steerDelta} steering follow-up${steerDelta === 1 ? '' : 's'} added`);
  else if (steerDelta < 0) parts.push(`${-steerDelta} steering follow-up${-steerDelta === 1 ? '' : 's'} removed`);
  if (queueDelta > 0) parts.push(`${queueDelta} queued follow-up${queueDelta === 1 ? '' : 's'} added`);
  else if (queueDelta < 0) parts.push(`${-queueDelta} queued follow-up${-queueDelta === 1 ? '' : 's'} removed`);
  return parts.length > 0 ? parts.join('. ') : null;
}

interface FollowUpTrayHostProps {
  steering: FollowUpMessage[];
  queued: FollowUpMessage[];
  visible: boolean;
  isRunActive: boolean;
  awaitingAskUser?: boolean;
  editingQueuedId?: string | null;
  onEditQueued: (item: FollowUpMessage) => void;
  onRemove: (id: string) => void;
  onSendNow: (id: string) => void;
}

export function FollowUpTrayHost({
  steering,
  queued,
  visible,
  isRunActive,
  awaitingAskUser = false,
  editingQueuedId = null,
  onEditQueued,
  onRemove,
  onSendNow
}: FollowUpTrayHostProps) {
  const prevCountsRef = useRef({ steering: 0, queued: 0 });
  const [ariaMessage, setAriaMessage] = useState('');

  useEffect(() => {
    const message = buildAriaLiveMessage(
      steering,
      queued,
      prevCountsRef.current.steering,
      prevCountsRef.current.queued
    );
    prevCountsRef.current = { steering: steering.length, queued: queued.length };
    if (message) setAriaMessage(message);
  }, [steering, queued]);

  if (!visible) return null;

  const hasItems = steering.length > 0 || queued.length > 0;
  if (!hasItems) return null;

  const staleSteering = steering.length > 0 && !isRunActive;

  return (
    <div
      className="vx-composer-followup-tray"
      data-testid="follow-up-tray"
      role="region"
      aria-label="Follow-up queue"
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {ariaMessage}
      </div>
      <QueuedFollowUpList
        items={queued}
        editingQueuedId={editingQueuedId}
        awaitingAskUser={awaitingAskUser}
        onEdit={onEditQueued}
        onRemove={onRemove}
        onSendNow={onSendNow}
      />
      <SteeringFollowUpZone items={steering} stale={staleSteering} onRemove={onRemove} />
    </div>
  );
}
