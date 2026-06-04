/**
 * Shown after a run ends on a terminal timeline error — retry the last
 * prompt or jump to provider settings when the failure looks API-related.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AlertCircle } from 'lucide-react';
import { useChatStore } from '../../store/useChatStore.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { selectRunRecoveryState } from '../../lib/runRecovery.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

interface ComposerRunRecoveryProps {
  model: ModelSelection | null;
  onOpenProviders: () => void;
}

export function ComposerRunRecovery({ model, onOpenProviders }: ComposerRunRecoveryProps) {
  const showToast = useToastStore((s) => s.show);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const settings = useSettingsStore((s) => s.settings);
  const permissions = selectEffectivePermissions(activeWorkspaceId, settings);

  const { events, isProcessing, lastUserPromptContent, send } = useChatStore(
    useShallow((s) => ({
      events: s.events,
      isProcessing: s.isProcessing,
      lastUserPromptContent: s.lastUserPromptContent,
      send: s.send
    }))
  );

  const recovery = useMemo(
    () => selectRunRecoveryState(events, isProcessing, lastUserPromptContent),
    [events, isProcessing, lastUserPromptContent]
  );

  if (!recovery) return null;

  const onRetry = () => {
    const prompt = lastUserPromptContent?.trim();
    if (!prompt) return;
    if (!model) {
      showToast('Select a model before retrying.', 'danger');
      return;
    }
    void send(prompt, model, permissions);
  };

  return (
    <div
      className={cn(
        'mb-2 flex flex-col gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2',
        'text-meta text-text-secondary'
      )}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className={cn(SHELL_ROW_ICON_CLASS, 'mt-0.5 shrink-0 text-danger')}
          strokeWidth={SHELL_ROW_ICON_STROKE}
          aria-hidden
        />
        <p className="min-w-0 flex-1 text-danger">{recovery.errorMessage}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
          Retry last message
        </Button>
        {recovery.suggestProviders ? (
          <Button type="button" size="sm" variant="link" onClick={onOpenProviders}>
            Open providers
          </Button>
        ) : null}
      </div>
    </div>
  );
}
