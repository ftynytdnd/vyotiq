/**
 * Settings → Agent behavior → Checkpoints — review pending file changes.
 */

import { useCallback, useEffect, useState } from 'react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { vyotiq } from '../../lib/ipc.js';
import { useActiveConversationId } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { ShellCaption, ShellRow, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { Button } from '../ui/Button.js';

export function CheckpointsPanel() {
  const conversationId = useActiveConversationId();
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setPending([]);
      return;
    }
    try {
      const rows = await vyotiq.checkpoints.listPending(conversationId);
      setPending(rows);
    } catch {
      setPending([]);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsub = vyotiq.checkpoints.onChanged(() => {
      void refresh();
    });
    return unsub;
  }, [refresh]);

  const acceptOne = async (entryId: string) => {
    setBusyId(entryId);
    try {
      await vyotiq.checkpoints.accept(entryId);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const rejectOne = async (entryId: string) => {
    setBusyId(entryId);
    try {
      await vyotiq.checkpoints.reject(entryId);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const acceptAllPending = async () => {
    if (!conversationId) return;
    setBusyId('all');
    try {
      await vyotiq.checkpoints.acceptAll(conversationId);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ShellSection title="Checkpoints">
      <ShellStack>
        <ShellCaption>
          Review agent file edits before they settle. Reject restores the pre-change file on disk.
        </ShellCaption>
        {!conversationId ? (
          <ShellCaption>No active conversation — open a chat to review pending changes.</ShellCaption>
        ) : pending.length === 0 ? (
          <ShellCaption>No pending file changes for this chat.</ShellCaption>
        ) : (
          <>
            <ShellRow>
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void acceptAllPending()}
              >
                Accept all ({pending.length})
              </Button>
            </ShellRow>
            {pending.map((row) => (
              <ShellRow key={row.entryId} className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 font-mono text-row text-text-secondary">
                  <span className="text-text-muted">{row.kind}</span>{' '}
                  <span className="truncate">{row.filePath}</span>
                  <span className="ml-2 text-meta text-text-faint">
                    +{row.additions}/−{row.deletions}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void acceptOne(row.entryId)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void rejectOne(row.entryId)}
                  >
                    Reject
                  </Button>
                </div>
              </ShellRow>
            ))}
          </>
        )}
        {workspaceId ? (
          <ShellCaption className="text-text-faint">
            Workspace id: {workspaceId.slice(0, 8)}…
          </ShellCaption>
        ) : null}
      </ShellStack>
    </ShellSection>
  );
}
