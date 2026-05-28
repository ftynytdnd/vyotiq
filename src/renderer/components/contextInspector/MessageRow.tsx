/**
 * MessageRow — single row in the Context Inspector message list.
 */

import { Layers } from 'lucide-react';
import { useChatStore } from '../../store/useChatStore.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import type {
  ContextInspectorMessage,
  ContextMessageOverride
} from '@shared/types/contextSummary.js';
import { Tabs } from '../ui/Tabs.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { labelForKind } from './inspectorFormat.js';
import { SurfaceShell, surfaceShellInnerClassName } from '../ui/SurfaceShell.js';

interface MessageRowProps {
  message: ContextInspectorMessage;
  conversationId: string;
}

const TOGGLE_OPTIONS: ReadonlyArray<{
  value: ContextMessageOverride;
  label: string;
  description: string;
}> = [
  {
    value: 'keep',
    label: 'Keep',
    description: 'Preserve verbatim — never summarize or drop.'
  },
  {
    value: 'summarize',
    label: 'Summarize',
    description: 'Always include in the summarizable range.'
  },
  {
    value: 'drop',
    label: 'Drop',
    description: 'Never send to the model. Preserved in the audit trail.'
  }
];

export function MessageRow({ message, conversationId }: MessageRowProps) {
  const liveOverride = useChatStore(
    (s) => s.slices[conversationId]?.messageOverrides[message.messageId]
  );
  const setMessageOverride = useContextSummaryStore((s) => s.setMessageOverride);
  const override: ContextMessageOverride | undefined =
    liveOverride ?? message.override;
  const effective = message.effectiveDecision;
  const activeValue: ContextMessageOverride = override ?? effective;

  const onSelect = (next: ContextMessageOverride) => {
    if (override === next) {
      void setMessageOverride(conversationId, message.messageId, null);
      return;
    }
    if (override === undefined && effective === next) return;
    void setMessageOverride(conversationId, message.messageId, next);
  };

  return (
    <li>
      <SurfaceShell
        className={cn(
          surfaceShellInnerClassName('compact'),
          'flex flex-col gap-2'
        )}
      >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {message.kind === 'system-summary' && message.fromSummary && (
            <Layers className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          )}
          <span className="truncate text-row text-text-primary" title={message.originLabel}>
            {message.originLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-text-secondary">
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
      <Tabs
        variant="segmented"
        size="sm"
        ariaLabel={`Override policy for ${message.originLabel}`}
        className="w-full min-w-0"
        items={TOGGLE_OPTIONS.map((opt) => ({
          id: opt.value,
          label: opt.label,
          panelId: undefined
        }))}
        value={activeValue}
        onChange={onSelect}
      />
      </SurfaceShell>
    </li>
  );
}
