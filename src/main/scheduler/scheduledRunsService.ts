/**
 * Interval scheduler for local agent runs.
 */

import { randomUUID } from 'node:crypto';
import { dispatchChatSend } from '../ipc/chat.ipc.js';
import { enqueueFollowUp } from '../followUps/followUpQueueService.js';
import { conversationHasActiveRun } from '../orchestrator/conversationHasActiveRun.js';
import { listScheduledRuns, touchScheduledRun } from './scheduledRunsStore.js';
import { logger } from '../logging/logger.js';
import type { ScheduledRun } from '@shared/types/scheduledRun.js';
import { FollowUpQueueFullError } from '@shared/types/followUp.js';
import { MAX_FOLLOW_UP_QUEUE_DEPTH } from '@shared/constants.js';
import { notifyUiToast } from '../ui/uiToast.js';
import { requestUserAttention } from '../window/requestUserAttention.js';

const log = logger.child('scheduler/service');

const TICK_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** runId → dueAt window we already toasted for queue-full */
const queueFullToastNotified = new Map<string, number>();

export function shouldDispatchScheduledRun(run: ScheduledRun, now: number): boolean {
  if (!run.enabled) return false;
  const dueAt = run.nextRunAt ?? run.createdAt;
  if (now < dueAt) return false;
  return run.prompt.trim().length > 0;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const runs = await listScheduledRuns();
    for (const run of runs) {
      if (!shouldDispatchScheduledRun(run, now)) continue;
      try {
        if (conversationHasActiveRun(run.conversationId)) {
          await enqueueFollowUp({
            conversationId: run.conversationId,
            kind: 'queue',
            prompt: run.prompt,
            selection: { providerId: run.providerId, modelId: run.modelId },
            source: 'scheduled'
          });
          await touchScheduledRun(run.id, now);
          queueFullToastNotified.delete(run.id);
          requestUserAttention('scheduled-enqueue');
          log.info('scheduled run enqueued — conversation busy', {
            id: run.id,
            label: run.label
          });
          continue;
        }
        await dispatchChatSend({
          runId: randomUUID(),
          conversationId: run.conversationId,
          workspaceId: run.workspaceId,
          prompt: run.prompt,
          selection: { providerId: run.providerId, modelId: run.modelId }
        });
        await touchScheduledRun(run.id, now);
        queueFullToastNotified.delete(run.id);
        log.info('scheduled run dispatched', { id: run.id, label: run.label });
      } catch (err: unknown) {
        if (err instanceof FollowUpQueueFullError) {
          const dueAt = run.nextRunAt ?? run.createdAt;
          log.warn('scheduled run not enqueued — queue lane full', {
            id: run.id,
            label: run.label,
            maxDepth: err.maxDepth
          });
          if (queueFullToastNotified.get(run.id) !== dueAt) {
            queueFullToastNotified.set(run.id, dueAt);
            notifyUiToast({
              conversationId: run.conversationId,
              variant: 'info',
              message: `Scheduled run "${run.label || 'Untitled'}" could not enqueue — queue is full (max ${MAX_FOLLOW_UP_QUEUE_DEPTH}).`
            });
          }
          continue;
        }
        log.warn('scheduled run failed', {
          id: run.id,
          err: err instanceof Error ? err.message : String(err)
        });
        queueFullToastNotified.delete(run.id);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduledRunsService(): void {
  if (timer !== null) return;
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  log.info('scheduled runs service started', { tickMs: TICK_MS });
}

export function stopScheduledRunsService(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
