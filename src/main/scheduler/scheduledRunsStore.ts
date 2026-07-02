/**
 * Scheduled local agent runs — persisted under userData.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { ScheduledRun } from '@shared/types/scheduledRun.js';
import { scheduledRunsFilePath, vyotiqDataDir } from '../paths/userDataLayout.js';
import { logger } from '../logging/logger.js';

const log = logger.child('scheduler/store');

function storePath(): string {
  return scheduledRunsFilePath();
}

let cache: ScheduledRun[] | null = null;

export async function listScheduledRuns(): Promise<ScheduledRun[]> {
  if (cache) return [...cache];
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as ScheduledRun[];
    cache = Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('failed to read scheduled runs', { err });
    }
    cache = [];
  }
  return [...cache];
}

async function persist(runs: ScheduledRun[]): Promise<void> {
  cache = runs;
  await fs.mkdir(vyotiqDataDir(), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(runs, null, 2), 'utf8');
}

export async function upsertScheduledRun(
  input: Omit<ScheduledRun, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<ScheduledRun> {
  const runs = await listScheduledRuns();
  const now = Date.now();
  const existingIdx = input.id ? runs.findIndex((r) => r.id === input.id) : -1;
  const next: ScheduledRun = {
    id: input.id ?? randomUUID(),
    enabled: input.enabled,
    label: input.label.trim(),
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    prompt: input.prompt,
    providerId: input.providerId,
    modelId: input.modelId,
    intervalMinutes: Math.max(5, Math.min(7 * 24 * 60, input.intervalMinutes)),
    lastRunAt: existingIdx >= 0 ? runs[existingIdx]!.lastRunAt : undefined,
    nextRunAt: input.enabled ? now : undefined,
    createdAt: existingIdx >= 0 ? runs[existingIdx]!.createdAt : now,
    updatedAt: now
  };
  if (existingIdx >= 0) runs[existingIdx] = next;
  else runs.push(next);
  await persist(runs);
  return next;
}

export async function deleteScheduledRun(id: string): Promise<boolean> {
  const runs = await listScheduledRuns();
  const next = runs.filter((r) => r.id !== id);
  if (next.length === runs.length) return false;
  await persist(next);
  return true;
}

export async function touchScheduledRun(id: string, lastRunAt: number): Promise<void> {
  const runs = await listScheduledRuns();
  const idx = runs.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const run = runs[idx]!;
  runs[idx] = {
    ...run,
    lastRunAt,
    nextRunAt: lastRunAt + run.intervalMinutes * 60_000,
    updatedAt: Date.now()
  };
  await persist(runs);
}

export async function disableScheduledRun(id: string): Promise<boolean> {
  const runs = await listScheduledRuns();
  const idx = runs.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  const run = runs[idx]!;
  runs[idx] = {
    ...run,
    enabled: false,
    nextRunAt: undefined,
    updatedAt: Date.now()
  };
  await persist(runs);
  return true;
}
