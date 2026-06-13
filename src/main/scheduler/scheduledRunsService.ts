/**
 * Interval scheduler for local agent runs.
 */

import { randomUUID } from 'node:crypto';
import { dispatchChatSend } from '../ipc/chat.ipc.js';
import { listActiveRuns } from '../orchestrator/AgentV.js';
import { listScheduledRuns, touchScheduledRun } from './scheduledRunsStore.js';
import { logger } from '../logging/logger.js';
import type { ScheduledRun } from '@shared/types/scheduledRun.js';

const log = logger.child('scheduler/service');

const TICK_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** True when the target conversation already has an in-flight orchestrator run. */
export function conversationHasActiveRun(conversationId: string): boolean {
  return listActiveRuns().some((r) => r.conversationId === conversationId);
}

export function shouldDispatchScheduledRun(run: ScheduledRun, now: number): boolean {
  if (!run.enabled) return false;
  const dueAt = run.nextRunAt ?? run.createdAt;
  if (now < dueAt) return false;
  if (run.prompt.trim().length === 0) return false;
  if (conversationHasActiveRun(run.conversationId)) return false;
  return true;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const runs = await listScheduledRuns();
    for (const run of runs) {
      if (!shouldDispatchScheduledRun(run, now)) {
        if (
          run.enabled &&
          run.prompt.trim().length > 0 &&
          now >= (run.nextRunAt ?? run.createdAt) &&
          conversationHasActiveRun(run.conversationId)
        ) {
          log.debug('scheduled run deferred — conversation busy', {
            id: run.id,
            conversationId: run.conversationId
          });
        }
        continue;
      }
      try {
        await dispatchChatSend({
          runId: randomUUID(),
          conversationId: run.conversationId,
          workspaceId: run.workspaceId,
          prompt: run.prompt,
          selection: { providerId: run.providerId, modelId: run.modelId }
        });
        await touchScheduledRun(run.id, now);
        log.info('scheduled run dispatched', { id: run.id, label: run.label });
      } catch (err: unknown) {
        log.warn('scheduled run failed', {
          id: run.id,
          err: err instanceof Error ? err.message : String(err)
        });
        await touchScheduledRun(run.id, now);
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
