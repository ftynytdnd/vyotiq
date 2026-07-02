/**
 * Per-conversation heartbeat poller — injects wake prompts into the existing loop.
 */

import { randomUUID } from 'node:crypto';
import { dispatchChatSend } from '../ipc/chat.ipc.js';
import { enqueueFollowUp } from '../followUps/followUpQueueService.js';
import { listActiveRuns } from '../orchestrator/AgentV.js';
import {
  conversationHasActiveRun,
  getActiveRunContextLevel
} from '../orchestrator/conversationHasActiveRun.js';
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
import { parseAutomationPrompt } from '@shared/skills/parseSkillSlash.js';

const log = logger.child('heartbeat/service');

/** Reuse scheduled-runs tick cadence — due windows are 5–10 minutes. */
const TICK_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let shuttingDown = false;
/** conversationId → nextWakeAt window we already toasted for queue-full */
const queueFullToastNotified = new Map<string, number>();

const CONTEXT_PRESSURE_DEFER_MS = 5 * 60_000;

function shouldDeferWakeForActiveRun(conversationId: string): boolean {
  if (!conversationHasActiveRun(conversationId)) return false;
  const level = getActiveRunContextLevel(conversationId);
  return level === 'trigger' || level === 'critical';
}

function conversationAwaitingUser(conversationId: string): boolean {
  return listActiveRuns().some(
    (run) => run.conversationId === conversationId && run.awaitingUser
  );
}

async function dispatchWake(row: ConversationHeartbeat): Promise<boolean> {
  if (shuttingDown) return false;
  const { conversationId, wakePrompt, selection } = row;
  const { prompt, invokedSkill } = parseAutomationPrompt(wakePrompt);
  if (conversationHasActiveRun(conversationId)) {
    if (conversationAwaitingUser(conversationId)) {
      try {
        await enqueueFollowUp({
          conversationId,
          kind: 'queue',
          prompt,
          selection,
          source: 'heartbeat',
          ...(invokedSkill ? { invokedSkill } : {})
        });
        log.info('heartbeat enqueued queued wake during ask_user', { conversationId });
        return true;
      } catch (err) {
        if (err instanceof FollowUpQueueFullError) {
          log.warn('heartbeat queue wake dropped — follow-up queue full', { conversationId });
          return false;
        }
        throw err;
      }
    }
    await enqueueFollowUp({
      conversationId,
      kind: 'steering',
      prompt,
      selection,
      source: 'heartbeat',
      ...(invokedSkill ? { invokedSkill } : {})
    });
    log.info('heartbeat enqueued steering wake', { conversationId });
    return true;
  }

  const reply = await dispatchChatSend({
    runId: randomUUID(),
    conversationId,
    workspaceId: row.workspaceId,
    prompt,
    selection,
    ...(invokedSkill ? { invokedSkill } : {})
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
      if (shouldDeferWakeForActiveRun(row.conversationId)) {
        log.info('heartbeat wake deferred — active run under context pressure', {
          conversationId: row.conversationId,
          level: getActiveRunContextLevel(row.conversationId)
        });
        await deferConversationHeartbeat(row.conversationId, now, CONTEXT_PRESSURE_DEFER_MS);
        continue;
      }
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
