/**
 * Per-conversation follow-up queue — main-process authoritative store.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_CHAT_ATTACHMENTS,
  MAX_FOLLOW_UP_QUEUE_DEPTH,
  IPC
} from '@shared/constants.js';
import type {
  ConversationFollowUpState,
  FollowUpEnqueueInput,
  FollowUpMessage,
  FollowUpUpdateInput
} from '@shared/types/followUp.js';
import { EMPTY_FOLLOW_UP_STATE, FollowUpQueueFullError } from '@shared/types/followUp.js';
import { parseFollowUpMessage } from '@shared/followUps/parseFollowUpMessage.js';
import { conversationsDir } from '../paths/userDataLayout.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { logger } from '../logging/logger.js';

const log = logger.child('follow-ups/store');

const memory = new Map<string, ConversationFollowUpState>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Bumped on commit/drop so in-flight debounced writes cannot resurrect deleted conversations. */
const persistGenerations = new Map<string, number>();

function bumpPersistGeneration(conversationId: string): number {
  const next = (persistGenerations.get(conversationId) ?? 0) + 1;
  persistGenerations.set(conversationId, next);
  return next;
}

function followUpsPath(conversationId: string): string {
  return join(conversationsDir(), `${conversationId}.followups.json`);
}

function cloneState(state: ConversationFollowUpState): ConversationFollowUpState {
  return {
    steering: state.steering.map((m) => ({ ...m, attachmentMeta: m.attachmentMeta?.map((a) => ({ ...a })) })),
    queued: state.queued.map((m) => ({ ...m, attachmentMeta: m.attachmentMeta?.map((a) => ({ ...a })) }))
  };
}

function normalizeLoaded(raw: unknown): ConversationFollowUpState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_FOLLOW_UP_STATE };
  const obj = raw as Record<string, unknown>;
  const steeringRaw = Array.isArray(obj.steering) ? obj.steering : [];
  const queuedRaw = Array.isArray(obj.queued) ? obj.queued : [];
  const steering: FollowUpMessage[] = [];
  const queued: FollowUpMessage[] = [];
  for (const row of steeringRaw) {
    const parsed = parseFollowUpMessage(row);
    if (parsed && parsed.kind === 'steering') steering.push(parsed);
  }
  for (const row of queuedRaw) {
    const parsed = parseFollowUpMessage(row);
    if (parsed && parsed.kind === 'queue') queued.push(parsed);
  }
  return { steering, queued };
}

async function readFromDisk(conversationId: string): Promise<ConversationFollowUpState> {
  try {
    const raw = await fs.readFile(followUpsPath(conversationId), 'utf8');
    return normalizeLoaded(JSON.parse(raw));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('failed to read follow-ups', { conversationId, err });
    }
    return { ...EMPTY_FOLLOW_UP_STATE };
  }
}

function schedulePersist(
  conversationId: string,
  state: ConversationFollowUpState,
  generation: number
): void {
  const existing = persistTimers.get(conversationId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    conversationId,
    setTimeout(() => {
      persistTimers.delete(conversationId);
      void (async () => {
        if (persistGenerations.get(conversationId) !== generation) return;
        try {
          const dir = conversationsDir();
          await fs.mkdir(dir, { recursive: true });
          const path = followUpsPath(conversationId);
          if (state.steering.length === 0 && state.queued.length === 0) {
            await fs.unlink(path).catch((err: unknown) => {
              if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
            });
          } else {
            await fs.writeFile(path, JSON.stringify(state, null, 2), 'utf8');
          }
        } catch (err: unknown) {
          log.warn('failed to persist follow-ups', { conversationId, err });
        }
      })();
    }, 300)
  );
}

function broadcastUpdated(conversationId: string, state: ConversationFollowUpState): void {
  safeWebContentsSend(IPC.FOLLOW_UPS_UPDATED, conversationId, cloneState(state));
}

function commit(conversationId: string, state: ConversationFollowUpState): ConversationFollowUpState {
  const next = cloneState(state);
  const generation = bumpPersistGeneration(conversationId);
  memory.set(conversationId, next);
  schedulePersist(conversationId, next, generation);
  broadcastUpdated(conversationId, next);
  return next;
}

/** Load follow-ups from disk when the in-memory cache is cold. */
export async function ensureFollowUpsLoaded(conversationId: string): Promise<ConversationFollowUpState> {
  const cached = memory.get(conversationId);
  if (cached) return cached;
  const loaded = await readFromDisk(conversationId);
  memory.set(conversationId, loaded);
  return loaded;
}

export async function listFollowUps(conversationId: string): Promise<ConversationFollowUpState> {
  const state = await ensureFollowUpsLoaded(conversationId);
  return cloneState(state);
}

function laneOf(state: ConversationFollowUpState, kind: FollowUpMessage['kind']): FollowUpMessage[] {
  return kind === 'steering' ? state.steering : state.queued;
}

function assertLaneCapacity(kind: FollowUpMessage['kind'], lane: FollowUpMessage[]): void {
  if (lane.length >= MAX_FOLLOW_UP_QUEUE_DEPTH) {
    throw new FollowUpQueueFullError(kind, MAX_FOLLOW_UP_QUEUE_DEPTH);
  }
}

export async function enqueueFollowUp(input: FollowUpEnqueueInput): Promise<ConversationFollowUpState> {
  const state = await listFollowUps(input.conversationId);
  const lane = laneOf(state, input.kind);
  assertLaneCapacity(input.kind, lane);

  const attachments = input.attachmentMeta ?? [];
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`Too many attachments (max ${MAX_CHAT_ATTACHMENTS})`);
  }

  const message: FollowUpMessage = {
    id: randomUUID(),
    kind: input.kind,
    prompt: input.prompt,
    selection: { ...input.selection },
    queuedAt: Date.now(),
    source: input.source ?? 'composer',
    ...(attachments.length > 0 ? { attachmentMeta: attachments.map((a) => ({ ...a })) } : {}),
    ...(input.mentions && input.mentions.length > 0
      ? { mentions: input.mentions.map((m) => ({ ...m })) }
      : {}),
    ...(input.promptEventId ? { promptEventId: input.promptEventId } : {})
  };

  lane.push(message);
  return commit(input.conversationId, state);
}

export async function updateFollowUp(input: FollowUpUpdateInput): Promise<ConversationFollowUpState> {
  const state = await listFollowUps(input.conversationId);
  const findIn = (lane: FollowUpMessage[]) => lane.find((m) => m.id === input.id);
  const target = findIn(state.steering) ?? findIn(state.queued);
  if (!target) throw new Error('Follow-up not found');

  if (input.prompt !== undefined) target.prompt = input.prompt;
  if (input.selection !== undefined) target.selection = { ...input.selection };
  if (input.attachmentMeta !== undefined) {
    if (input.attachmentMeta.length > MAX_CHAT_ATTACHMENTS) {
      throw new Error(`Too many attachments (max ${MAX_CHAT_ATTACHMENTS})`);
    }
    target.attachmentMeta =
      input.attachmentMeta.length > 0 ? input.attachmentMeta.map((a) => ({ ...a })) : undefined;
  }
  if (input.mentions !== undefined) {
    target.mentions =
      input.mentions.length > 0 ? input.mentions.map((m) => ({ ...m })) : undefined;
  }

  return commit(input.conversationId, state);
}

export async function removeFollowUp(
  conversationId: string,
  id: string
): Promise<ConversationFollowUpState> {
  const state = await listFollowUps(conversationId);
  state.steering = state.steering.filter((m) => m.id !== id);
  state.queued = state.queued.filter((m) => m.id !== id);
  return commit(conversationId, state);
}

/** Dequeue one steering item (FIFO). Hydrates from disk when memory is cold. */
export async function takeSteeringFollowUp(conversationId: string): Promise<FollowUpMessage | undefined> {
  const state = await ensureFollowUpsLoaded(conversationId);
  if (state.steering.length === 0) return undefined;
  const [head, ...rest] = state.steering;
  state.steering = rest;
  commit(conversationId, state);
  return head;
}

/** Dequeue the head queued item (FIFO). Hydrates from disk when memory is cold. */
export async function takeQueuedFollowUp(conversationId: string): Promise<FollowUpMessage | undefined> {
  const state = await ensureFollowUpsLoaded(conversationId);
  if (state.queued.length === 0) return undefined;
  const [head, ...rest] = state.queued;
  state.queued = rest;
  commit(conversationId, state);
  return head;
}

/** Peek the head queued item without dequeuing. Hydrates from disk when memory is cold. */
export async function peekQueuedFollowUp(conversationId: string): Promise<FollowUpMessage | undefined> {
  const state = await ensureFollowUpsLoaded(conversationId);
  return state.queued[0];
}

/** Put a dequeued item back at the head of the queued lane (e.g. after dispatch failure). */
export async function restoreQueuedFollowUpAtHead(
  conversationId: string,
  item: FollowUpMessage
): Promise<ConversationFollowUpState> {
  const state = await ensureFollowUpsLoaded(conversationId);
  state.queued = state.queued.filter((m) => m.id !== item.id);
  state.queued.unshift(item);
  return commit(conversationId, state);
}

export function dropFollowUpsForConversation(conversationId: string): void {
  bumpPersistGeneration(conversationId);
  memory.delete(conversationId);
  const timer = persistTimers.get(conversationId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(conversationId);
  }
  void fs.unlink(followUpsPath(conversationId)).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('failed to delete follow-ups file', { conversationId, err });
    }
  });
}

/** For tests — reset in-memory state without touching disk. */
export function _resetFollowUpStoreForTests(): void {
  memory.clear();
  persistGenerations.clear();
  for (const timer of persistTimers.values()) clearTimeout(timer);
  persistTimers.clear();
}
