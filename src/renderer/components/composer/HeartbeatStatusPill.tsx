/**
 * Read-only heartbeat status in the composer metrics row.
 * Attach/detach is agent-controlled via the `heartbeat` tool only.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import type { ConversationHeartbeat } from '@shared/types/conversationHeartbeat.js';
import { vyotiq } from '../../lib/ipc.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

interface HeartbeatStatusPillProps {
  conversationId: string | null;
  compact?: boolean;
}

export const HeartbeatStatusPill = memo(function HeartbeatStatusPill({
  conversationId,
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
    const offUpdated = vyotiq.heartbeat.onUpdated((updatedId, nextRow) => {
      if (updatedId === conversationId) {
        setRow(nextRow);
      }
    });
    return () => {
      offUpdated();
    };
  }, [refresh, conversationId]);

  if (!conversationId || !row) return null;

  const label = compact ? `${row.intervalMinutes}m` : `Heartbeat · ${row.intervalMinutes}m`;

  return (
    <span
      className={cn(
        'vx-composer-cache-pill shrink-0 text-meta text-accent-primary',
        'inline-flex items-center'
      )}
      role="status"
      title="Agent attached a periodic wake for async work (PR/CI cycles)"
    >
      <Activity className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
      <span className="ml-1">{label}</span>
    </span>
  );
});
