/**
 * Vertical thinking-effort option list with checkmarks (composer picker + Settings).
 */

import { Check } from 'lucide-react';
import type { ProviderDialect, ThinkingEffort } from '@shared/types/provider.js';
import {
  isThinkingCapableModel,
  supportedThinkingEfforts,
  THINKING_EFFORT_LABELS
} from '@shared/providers/thinkingEffort.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ACTION_ICON_STROKE } from '../../lib/shellIcons.js';

export interface ThinkingEffortOptionListProps {
  dialect?: ProviderDialect;
  modelId: string;
  value: ThinkingEffort | undefined;
  onSelect: (effort: ThinkingEffort) => void;
  onClear: () => void;
  /** When false, omits the section title (compact Settings column). */
  showHeading?: boolean;
  className?: string;
}

export function ThinkingEffortOptionList({
  dialect,
  modelId,
  value,
  onSelect,
  onClear,
  showHeading = true,
  className
}: ThinkingEffortOptionListProps) {
  if (!isThinkingCapableModel(dialect, modelId)) return null;
  const levels = supportedThinkingEfforts(dialect, modelId);
  if (levels.length === 0) return null;

  return (
    <div
      className={cn('flex min-h-0 flex-col py-1', className)}
      role="group"
      aria-label={`Thinking effort for ${modelId}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {showHeading ? (
        <div className="px-2.5 py-1 text-meta font-medium text-text-faint">Effort</div>
      ) : null}
      <div className="scrollbar-stealth flex min-h-0 flex-1 flex-col gap-px px-1">
        <EffortOption label="Default" selected={value === undefined} onClick={onClear} />
        {levels.map((lvl) => (
          <EffortOption
            key={lvl}
            label={THINKING_EFFORT_LABELS[lvl]}
            selected={value === lvl}
            onClick={() => onSelect(lvl)}
          />
        ))}
      </div>
    </div>
  );
}

function EffortOption({
  label,
  selected,
  onClick
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={selected ? 'true' : 'false'}
      className={cn(
        'vx-dropdown-item flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-row',
        selected && 'text-text-primary'
      )}
    >
      <span>{label}</span>
      <Check
        className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0', selected ? 'text-accent' : 'opacity-0')}
        strokeWidth={SHELL_ACTION_ICON_STROKE}
        aria-hidden
      />
    </button>
  );
}
