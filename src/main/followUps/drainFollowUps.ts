/**
 * Post-run follow-up drain — dispatch queued items when conversation is idle.
 */

import {
  listFollowUps,
  peekQueuedFollowUp,
  removeFollowUp,
  restoreQueuedFollowUpAtHead,
  takeQueuedFollowUp
} from './followUpQueueService.js';
import { findAllActiveRunsForConversation } from '../orchestrator/AgentV.js';
import { conversationHasActiveRun } from '../orchestrator/conversationHasActiveRun.js';
import { followUpToChatSendInput } from '../orchestrator/followUps/injectFollowUp.js';
import { dispatchChatSend } from '../ipc/chat.ipc.js';
import { getConversationMeta } from '../conversations/conversationStore.js';
import { logger } from '../logging/logger.js';

const log = logger.child('follow-ups/drain');

const draining = new Set<string>();
/** Suppresses post-abort drain while send-now owns dispatch for a conversation. */
const suppressDrain = new Set<string>();

export { conversationHasActiveRun };

/**
 * After a run settles, start the next queued follow-up when the conversation is idle.
 */
export async function drainFollowUpsForConversation(conversationId: string): Promise<void> {
  if (draining.has(conversationId)) return;
  if (suppressDrain.has(conversationId)) return;
  if (conversationHasActiveRun(conversationId)) return;

  const peek = await peekQueuedFollowUp(conversationId);
  if (!peek) return;

  draining.add(conversationId);
  try {
    while (!conversationHasActiveRun(conversationId) && !suppressDrain.has(conversationId)) {
      const head = await peekQueuedFollowUp(conversationId);
      if (!head) break;

      const meta = await getConversationMeta(conversationId);
      const workspaceId = meta?.workspaceId;
      if (!workspaceId) {
        log.warn('drain paused — conversation missing workspaceId', { conversationId });
        break;
      }

      const next = await takeQueuedFollowUp(conversationId);
      if (!next) break;

      try {
        await dispatchChatSend(followUpToChatSendInput(next, conversationId, workspaceId));
        log.info('drained queued follow-up', { conversationId, followUpId: next.id });
        break;
      } catch (err: unknown) {
        log.warn('drain dispatch failed — restoring head item', {
          conversationId,
          followUpId: next.id,
          err
        });
        await restoreQueuedFollowUpAtHead(conversationId, next);
        break;
      }
    }
  } finally {
    draining.delete(conversationId);
  }
}

/**
 * Send-now: abort in-flight run, then dispatch the chosen queued item immediately.
 * Item stays in queue until dispatch succeeds; drain is suppressed during this flow.
 */
export async function sendQueuedFollowUpNow(conversationId: string, id: string): Promise<void> {
  const state = await listFollowUps(conversationId);
  const target = state.queued.find((m) => m.id === id);
  if (!target) return;

  suppressDrain.add(conversationId);
  try {
    const activeRunIds = findAllActiveRunsForConversation(conversationId);
    const { abortRun } = await import('../orchestrator/AgentV.js');
    const { awaitRunSettlement } = await import('../ipc/runSettlement.js');
    const { drainAppendChain } = await import('../conversations/conversationStore.js');

    for (const rid of activeRunIds) abortRun(rid);
    if (activeRunIds.length > 0) {
      await awaitRunSettlement(conversationId);
      await drainAppendChain(conversationId);
    }

    if (conversationHasActiveRun(conversationId)) {
      throw new Error('Conversation still has an active run');
    }

    const meta = await getConversationMeta(conversationId);
    const workspaceId = meta?.workspaceId;
    if (!workspaceId) {
      throw new Error('Conversation workspace not found');
    }

    await dispatchChatSend(followUpToChatSendInput(target, conversationId, workspaceId));
    await removeFollowUp(conversationId, id);
  } catch (err: unknown) {
    log.warn('sendQueuedFollowUpNow failed', { conversationId, id, err });
    throw err;
  } finally {
    suppressDrain.delete(conversationId);
  }
}
