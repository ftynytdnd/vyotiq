/**
 * Tracks when memory notes and recalled conversations were last touched in chat.
 * Persisted under userData so the Memory panel can show "last referenced".
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getConversationMeta } from '../conversations/conversationStore.js';

const STORE_FILE = path.join('vyotiq', 'memory-last-referenced.json');

/** Bucket id for global meta-rules last-ref (not a real workspace). */
export const GLOBAL_MEMORY_WORKSPACE_ID = '__global__';

/** Key for the single global meta-rules entry. */
export const GLOBAL_MEMORY_KEY = 'meta-rules.md';

/** Prefix for keys recording `recall read` of another conversation. */
export const RECALL_CONVERSATION_KEY_PREFIX = 'conversation:';

export function recallConversationKey(conversationId: string): string {
  return `${RECALL_CONVERSATION_KEY_PREFIX}${conversationId}`;
}

export interface MemoryLastReference {
  conversationId: string;
  conversationTitle: string;
  at: number;
}

type StoreShape = Record<string, Record<string, MemoryLastReference>>;

function storePath(): string {
  return path.join(app.getPath('userData'), STORE_FILE);
}

async function readStore(): Promise<StoreShape> {
  const file = storePath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as StoreShape;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  const file = storePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2), 'utf8');
}

export async function getMemoryLastReference(
  workspaceId: string,
  key: string
): Promise<MemoryLastReference | null> {
  const store = await readStore();
  return store[workspaceId]?.[key] ?? null;
}

export async function touchMemoryLastReference(
  workspaceId: string,
  key: string,
  conversationId: string
): Promise<MemoryLastReference> {
  const meta = await getConversationMeta(conversationId);
  const ref: MemoryLastReference = {
    conversationId,
    conversationTitle: meta?.title?.trim() || 'Untitled chat',
    at: Date.now()
  };
  const store = await readStore();
  const ws = { ...(store[workspaceId] ?? {}) };
  ws[key] = ref;
  await writeStore({ ...store, [workspaceId]: ws });
  return ref;
}

export async function getGlobalMemoryLastReference(): Promise<MemoryLastReference | null> {
  return getMemoryLastReference(GLOBAL_MEMORY_WORKSPACE_ID, GLOBAL_MEMORY_KEY);
}

export async function touchGlobalMemoryLastReference(
  conversationId: string
): Promise<MemoryLastReference> {
  return touchMemoryLastReference(
    GLOBAL_MEMORY_WORKSPACE_ID,
    GLOBAL_MEMORY_KEY,
    conversationId
  );
}

export async function touchRecallConversationLastReference(
  workspaceId: string,
  recalledConversationId: string,
  activeConversationId: string
): Promise<MemoryLastReference> {
  return touchMemoryLastReference(
    workspaceId,
    recallConversationKey(recalledConversationId),
    activeConversationId
  );
}

export async function listMemoryLastReferences(
  workspaceId: string
): Promise<Record<string, MemoryLastReference>> {
  const store = await readStore();
  return store[workspaceId] ?? {};
}
