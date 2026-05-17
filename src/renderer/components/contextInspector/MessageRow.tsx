/**
 * Single message row in the Context Inspector's MessageList.
 *
 * Visual contract: matches the row pattern used in
 * `WorkspaceOverridesSection` and `WorkspaceCheckpointOverridesSection`
 * — flat list under a `border-b border-border-subtle/30 py-2`
 * separator, label + meta on the left, action surface on the right.
 * No card-in-card chrome. Toggle controls reuse the shared
 * `Button size="sm" variant={...}` primitive instead of bespoke
 * pills so the typography + hover behavior stays in lockstep with
 * the rest of the app.
 *
 * Three toggle states:
 *   - Click an INACTIVE option → set that override.
 *   - Click the ACTIVE option (when an override is set) → clear
 *     the override (fall back to the per-kind policy).
 *   - Click while no override is set on the active policy match
 *     → no-op (state is already what the user is asking for).
 */

import { Layers } from 'lucide-react';
import { useChatStore } from '../../store/useChatStore.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import type {
  ContextInspectorMessage,
  ContextMessageOverride
} from '@shared/types/contextSummary.js';
import { Button } from '../ui/Button.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { labelForDecision, labelForKind } from './inspectorFormat.js';

interface MessageRowProps {
  message: ContextInspectorMessage;
  conversationId: string;
}

const TOGGLE_OPTIONS: ReadonlyArray<{
  value: ContextMessageOverride;
  description: string;
}> = [
    {
      value: 'keep',
      description: 'Preserve verbatim — never summarize or drop.'
    },
    {
      value: 'summarize',
      description: 'Always include in the summarizable range.'
    },
    {
      value: 'drop',
      description: 'Never send to the model. Preserved in the audit trail.'
    }
  ];

export function MessageRow({ message, conversationId }: MessageRowProps) {
  const liveOverride = useChatStore(
    (s) => s.messageOverrides[message.messageId]
  );
  const setMessageOverride = useContextSummaryStore((s) => s.setMessageOverride);
  // Prefer the live mirror — it reflects the streaming state of the
  // run. Fall back to the snapshot-supplied value (idle inspector,
  // pre-mirror IPC race).
  const override: ContextMessageOverride | undefined =
    liveOverride ?? message.override;
  const effective = message.effectiveDecision;

  const onSelect = (next: ContextMessageOverride) => {
    if (override === next) {
      void setMessageOverride(conversationId, message.messageId, null);
      return;
    }
    if (override === undefined && effective === next) return;
    void setMessageOverride(conversationId, message.messageId, next);
  };

  return (
    <li className="flex items-start justify-between gap-4 border-b border-border-subtle/30 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {message.kind === 'system-summary' && message.fromSummary && (
            <Layers className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
          )}
          <span className="truncate text-row text-text-primary" title={message.originLabel}>
            {message.originLabel}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-text-faint">
          <span>{labelForKind(message.kind)}</span>
          <span className="font-mono">{formatTokenCount(message.tokenEstimate)} tok</span>
          <span className="font-mono">{formatTokenCount(message.charCount)} chr</span>
          {override !== undefined && (
            <span title="An explicit override is set on this message. Click the active option to clear it.">
              override
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {TOGGLE_OPTIONS.map((opt) => {
          const isActive =
            override === opt.value ||
            (override === undefined && effective === opt.value);
          return (
            <Button
              key={opt.value}
              size="sm"
              variant={isActive ? 'primary' : 'ghost'}
              onClick={() => onSelect(opt.value)}
              title={opt.description}
            >
              {labelForDecision(opt.value)}
            </Button>
          );
        })}
      </div>
    </li>
  );
}
