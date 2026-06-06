/**
 * Re-run a settled read/ls/search/memory tool from the timeline UI.
 */

import { useCallback, useState } from 'react';
import type { ToolCall, RegisteredToolName } from '@shared/types/tool.js';
import { isRerunnableToolCall } from '@shared/tools/toolRerun.js';
import { vyotiq } from '../../../../lib/ipc.js';
import { useChatStore } from '../../../../store/useChatStore.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../../../store/useWorkspaceStore.js';
import { useToastStore } from '../../../../store/useToastStore.js';

export function canRerunToolCall(
  call: ToolCall
): call is ToolCall & { name: RegisteredToolName } {
  return isRerunnableToolCall(call);
}

export function useToolRerun() {
  const conversationId = useChatStore((s) => s.conversationId);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const settings = useSettingsStore((s) => s.settings);
  const permissions = selectEffectivePermissions(activeWorkspaceId, settings);
  const showToast = useToastStore((s) => s.show);
  const [busyCallId, setBusyCallId] = useState<string | null>(null);

  const rerun = useCallback(
    async (call: ToolCall) => {
      if (!conversationId) {
        showToast('Open a conversation before re-running a tool.', 'info');
        return false;
      }
      if (isProcessing) {
        showToast('Wait for the current run to finish before re-running a tool.', 'info');
        return false;
      }
      if (!canRerunToolCall(call)) {
        showToast(`Re-run is not available for ${call.name}.`, 'info');
        return false;
      }
      setBusyCallId(call.id);
      try {
        const reply = await vyotiq.tools.rerun({
          conversationId,
          toolName: call.name,
          args: call.args,
          permissions
        });
        if (!reply.ok) {
          showToast(reply.message ?? 'Tool re-run failed.', 'danger');
          return false;
        }
        showToast('Tool re-run complete.', 'success');
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(message, 'danger');
        return false;
      } finally {
        setBusyCallId(null);
      }
    },
    [conversationId, isProcessing, permissions, showToast]
  );

  return { rerun, busyCallId, canRerun: !isProcessing && conversationId !== null };
}
