/**
 * Per-conversation heartbeat poller — injects wake prompts into the existing loop.
 */

import { randomUUID } from 'node:crypto';
import { dispatchChatSend } from '../ipc/chat.ipc.js';
import { enqueueFollowUp } from '../followUps/followUpQueueService.js';
import { conversationHasActiveRun } from '../orchestrator/conversationHasActiveRun.js';
import {
  listConversationHeartbeats,
  shouldWakeHeartbeat,
  touchConversationHeartbeat,
  deferConversationHeartbeat,
  detachConversationHeartbeat
} from './conversationHeartbeatStore.js';
import { logger } from '../logging/logger.js';
import type { ConversationHeartbeat } from '@shared/types/conversationHeartbeat.js';
import { FollowUpQueueFullError } from '@shared/types/followUp.js';
import { MAX_FOLLOW_UP_QUEUE_DEPTH } from '@shared/constants.js';
import { notifyUiToast } from '../ui/uiToast.js';

const log = logger.child('heartbeat/service');

/** Reuse scheduled-runs tick cadence — due windows are 5–10 minutes. */
const TICK_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let shuttingDown = false;
/** conversationId → nextWakeAt window we already toasted for queue-full */
const queueFullToastNotified = new Map<string, number>();

export { conversationHasActiveRun };

async function dispatchWake(row: ConversationHeartbeat): Promise<boolean> {
  if (shuttingDown) return false;
  const { conversationId, wakePrompt, selection } = row;
  if (conversationHasActiveRun(conversationId)) {
    await enqueueFollowUp({
      conversationId,
      kind: 'steering',
      prompt: wakePrompt,
      selection,
      source: 'heartbeat'
    });
    log.info('heartbeat enqueued steering wake', { conversationId });
    return true;
  }

  const reply = await dispatchChatSend({
    runId: randomUUID(),
    conversationId,
    workspaceId: row.workspaceId,
    prompt: wakePrompt,
    selection
  });
  if (!reply.ok) {
    log.warn('heartbeat wake rejected by chat:send', {
      conversationId,
      kind: reply.kind
    });
    if (reply.kind === 'unknown-conversation') {
      await detachConversationHeartbeat(conversationId);
    }
    return false;
  }
  log.info('heartbeat dispatched wake run', { conversationId });
  return true;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const rows = await listConversationHeartbeats();
    for (const row of rows) {
      if (!shouldWakeHeartbeat(row, now)) continue;
      try {
        const dispatched = await dispatchWake(row);
        if (dispatched) {
          await touchConversationHeartbeat(row.conversationId, now);
          queueFullToastNotified.delete(row.conversationId);
        }
      } catch (err: unknown) {
        if (err instanceof FollowUpQueueFullError) {
          const dueAt = row.nextWakeAt ?? row.createdAt;
          log.warn('heartbeat wake not enqueued — queue lane full', {
            conversationId: row.conversationId,
            maxDepth: err.maxDepth
          });
          const deferMs = Math.min(row.intervalMinutes * 60_000, 5 * 60_000);
          await deferConversationHeartbeat(row.conversationId, now, deferMs);
          if (queueFullToastNotified.get(row.conversationId) !== dueAt) {
            queueFullToastNotified.set(row.conversationId, dueAt);
            notifyUiToast({
              conversationId: row.conversationId,
              variant: 'info',
              message: `Heartbeat could not enqueue — steering lane is full (max ${MAX_FOLLOW_UP_QUEUE_DEPTH}).`
            });
          }
          continue;
        }
        log.warn('heartbeat wake failed', {
          conversationId: row.conversationId,
          err: err instanceof Error ? err.message : String(err)
        });
        queueFullToastNotified.delete(row.conversationId);
      }
    }
  } finally {
    running = false;
  }
}

export function startConversationHeartbeatService(): void {
  if (timer) return;
  shuttingDown = false;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  timer.unref();
  log.info('conversation heartbeat service started', { tickMs: TICK_MS });
}

export function stopConversationHeartbeatService(): void {
  shuttingDown = true;
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  queueFullToastNotified.clear();
}

/** Test hook — run one poll cycle (ignores shutdown latch). */
export async function runConversationHeartbeatTickForTests(): Promise<void> {
  const wasShuttingDown = shuttingDown;
  shuttingDown = false;
  try {
    await tick();
  } finally {
    shuttingDown = wasShuttingDown;
  }
}
