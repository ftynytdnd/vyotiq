/**
 * Per-conversation heartbeat persistence under userData.
 */

import { promises as fs } from 'node:fs';
import type {
  ConversationHeartbeat,
  HeartbeatAttachInput
} from '@shared/types/conversationHeartbeat.js';
import {
  HEARTBEAT_MAX_INTERVAL_MINUTES,
  HEARTBEAT_MIN_INTERVAL_MINUTES
} from '@shared/constants.js';
import { conversationHeartbeatsFilePath, vyotiqDataDir } from '../paths/userDataLayout.js';
import { DEFAULT_HEARTBEAT_WAKE_PROMPT } from './defaultWakePrompt.js';
import { logger } from '../logging/logger.js';
import { atomicWriteJson } from '../checkpoints/atomicWrite.js';
import { IPC } from '@shared/constants.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';

const log = logger.child('heartbeat/store');

let cache: ConversationHeartbeat[] | null = null;

function storePath(): string {
  return conversationHeartbeatsFilePath();
}

function clampIntervalMinutes(minutes: number): number {
  return Math.max(
    HEARTBEAT_MIN_INTERVAL_MINUTES,
    Math.min(HEARTBEAT_MAX_INTERVAL_MINUTES, Math.round(minutes))
  );
}

export async function listConversationHeartbeats(): Promise<ConversationHeartbeat[]> {
  if (cache) return [...cache];
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as ConversationHeartbeat[];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('failed to read conversation heartbeats', { err });
    }
    cache = [];
  }
  return [...cache];
}

async function persist(rows: ConversationHeartbeat[]): Promise<void> {
  cache = rows;
  await fs.mkdir(vyotiqDataDir(), { recursive: true });
  await atomicWriteJson(storePath(), rows);
}

function broadcastHeartbeatUpdated(
  conversationId: string,
  row: ConversationHeartbeat | null
): void {
  safeWebContentsSend(IPC.HEARTBEAT_UPDATED, conversationId, row);
}

export async function getConversationHeartbeat(
  conversationId: string
): Promise<ConversationHeartbeat | null> {
  const rows = await listConversationHeartbeats();
  return rows.find((r) => r.conversationId === conversationId) ?? null;
}

export async function attachConversationHeartbeat(
  input: HeartbeatAttachInput
): Promise<ConversationHeartbeat> {
  const rows = await listConversationHeartbeats();
  const now = Date.now();
  const intervalMinutes = clampIntervalMinutes(input.intervalMinutes);
  const wakePrompt =
    input.wakePrompt?.trim() || DEFAULT_HEARTBEAT_WAKE_PROMPT;
  const existingIdx = rows.findIndex((r) => r.conversationId === input.conversationId);
  const next: ConversationHeartbeat = {
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    enabled: true,
    intervalMinutes,
    wakePrompt,
    selection: { ...input.selection },
    lastWakeAt: existingIdx >= 0 ? rows[existingIdx]!.lastWakeAt : undefined,
    nextWakeAt: now + intervalMinutes * 60_000,
    createdAt: existingIdx >= 0 ? rows[existingIdx]!.createdAt : now,
    updatedAt: now
  };
  if (existingIdx >= 0) rows[existingIdx] = next;
  else rows.push(next);
  await persist(rows);
  broadcastHeartbeatUpdated(input.conversationId, next);
  return next;
}

export async function detachConversationHeartbeat(conversationId: string): Promise<boolean> {
  const rows = await listConversationHeartbeats();
  const next = rows.filter((r) => r.conversationId !== conversationId);
  if (next.length === rows.length) return false;
  await persist(next);
  broadcastHeartbeatUpdated(conversationId, null);
  return true;
}

/** Keep heartbeat workspace binding aligned after conversation reparent/move. */
export async function updateConversationHeartbeatWorkspace(
  conversationId: string,
  workspaceId: string
): Promise<void> {
  const rows = await listConversationHeartbeats();
  const idx = rows.findIndex((r) => r.conversationId === conversationId);
  if (idx < 0) return;
  const row = rows[idx]!;
  if (row.workspaceId === workspaceId) return;
  rows[idx] = { ...row, workspaceId, updatedAt: Date.now() };
  await persist(rows);
}

export async function touchConversationHeartbeat(
  conversationId: string,
  lastWakeAt: number
): Promise<void> {
  const rows = await listConversationHeartbeats();
  const idx = rows.findIndex((r) => r.conversationId === conversationId);
  if (idx < 0) return;
  const row = rows[idx]!;
  rows[idx] = {
    ...row,
    lastWakeAt,
    nextWakeAt: lastWakeAt + row.intervalMinutes * 60_000,
    updatedAt: Date.now()
  };
  await persist(rows);
}

/** Push next wake forward without counting a successful wake (queue-full backoff). */
export async function deferConversationHeartbeat(
  conversationId: string,
  now: number,
  deferMs: number
): Promise<void> {
  const rows = await listConversationHeartbeats();
  const idx = rows.findIndex((r) => r.conversationId === conversationId);
  if (idx < 0) return;
  const row = rows[idx]!;
  rows[idx] = {
    ...row,
    nextWakeAt: now + deferMs,
    updatedAt: Date.now()
  };
  await persist(rows);
}

export function shouldWakeHeartbeat(row: ConversationHeartbeat, now: number): boolean {
  if (!row.enabled) return false;
  const dueAt = row.nextWakeAt ?? row.createdAt;
  return now >= dueAt && row.wakePrompt.trim().length > 0;
}

export function __resetConversationHeartbeatStoreForTests(): void {
  cache = null;
}
