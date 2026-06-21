/**
 * Shows per-conversation heartbeat attachment in the composer metrics row.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import type { ConversationHeartbeat } from '@shared/types/conversationHeartbeat.js';
import { vyotiq } from '../../lib/ipc.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { useToastStore } from '../../store/useToastStore.js';

interface HeartbeatStatusPillProps {
  conversationId: string | null;
  workspaceId: string | null;
  modelProviderId?: string | null;
  modelId?: string | null;
  compact?: boolean;
}

export const HeartbeatStatusPill = memo(function HeartbeatStatusPill({
  conversationId,
  workspaceId,
  modelProviderId,
  modelId,
  compact = false
}: HeartbeatStatusPillProps) {
  const [row, setRow] = useState<ConversationHeartbeat | null>(null);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setRow(null);
      return;
    }
    try {
      setRow(await vyotiq.heartbeat.get(conversationId));
    } catch {
      setRow(null);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 30_000);
    const offUpdated = vyotiq.heartbeat.onUpdated((updatedId, row) => {
      if (updatedId === conversationId) {
        setRow(row);
      }
    });
    return () => {
      clearInterval(id);
      offUpdated();
    };
  }, [refresh, conversationId]);

  const detach = useCallback(async () => {
    if (!conversationId) return;
    try {
      await vyotiq.heartbeat.detach({ conversationId });
      setRow(null);
      useToastStore.getState().show('Heartbeat detached.', 'info');
    } catch {
      useToastStore.getState().show('Could not detach heartbeat.', 'danger');
    }
  }, [conversationId]);

  if (!conversationId || !workspaceId || !modelProviderId || !modelId) return null;

  if (!row) {
    return (
      <button
        type="button"
        className={cn(
          'vx-composer-cache-pill shrink-0 text-meta text-text-secondary',
          'hover:text-text-primary'
        )}
        title="Attach a periodic wake for async work (PR/CI cycles)"
        onClick={() => {
          void vyotiq.heartbeat
            .attach({
              conversationId,
              workspaceId,
              intervalMinutes: 7,
              selection: { providerId: modelProviderId, modelId }
            })
            .then((attached) => {
              setRow(attached);
              useToastStore.getState().show('Heartbeat attached.', 'info');
            })
            .catch(() => {
              useToastStore.getState().show('Could not attach heartbeat.', 'danger');
            });
        }}
      >
        <Activity className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
        {!compact ? <span className="ml-1">Heartbeat</span> : null}
      </button>
    );
  }

  const label = compact ? `${row.intervalMinutes}m` : `Heartbeat · ${row.intervalMinutes}m`;

  return (
    <button
      type="button"
      className={cn(
        'vx-composer-cache-pill shrink-0 text-meta text-accent-primary',
        'hover:text-text-primary'
      )}
      title="Click to detach heartbeat"
      onClick={() => void detach()}
    >
      <Activity className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
      <span className="ml-1">{label}</span>
    </button>
  );
});
