/**
 * Scheduled runs IPC — CRUD for local interval agent prompts.
 */

import { IPC } from '@shared/constants.js';
import type { ScheduledRun, ScheduledRunInput } from '@shared/types/scheduledRun.js';
import {
  deleteScheduledRun,
  listScheduledRuns,
  upsertScheduledRun
} from '../scheduler/scheduledRunsStore.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertBoolean,
  assertNumber,
  assertObject,
  assertOptionalString,
  assertString
} from './validate.js';

function broadcastScheduledRunsUpdated(runs: ScheduledRun[]): void {
  safeWebContentsSend(IPC.SCHEDULED_RUNS_UPDATED, runs);
}

export function registerScheduledRunsIpc(): void {
  wrapIpcHandler(IPC.SCHEDULED_RUNS_LIST, async (): Promise<ScheduledRun[]> => {
    return listScheduledRuns();
  });

  wrapIpcHandler(IPC.SCHEDULED_RUNS_UPSERT, async (_event, input: ScheduledRunInput): Promise<ScheduledRun> => {
    assertObject('scheduled-runs:upsert', 'input', input);
    assertBoolean('scheduled-runs:upsert', 'input.enabled', input.enabled);
    assertString('scheduled-runs:upsert', 'input.label', input.label);
    assertString('scheduled-runs:upsert', 'input.workspaceId', input.workspaceId);
    assertString('scheduled-runs:upsert', 'input.conversationId', input.conversationId);
    assertString('scheduled-runs:upsert', 'input.prompt', input.prompt, { nonEmpty: false });
    assertString('scheduled-runs:upsert', 'input.providerId', input.providerId);
    assertString('scheduled-runs:upsert', 'input.modelId', input.modelId);
    assertNumber('scheduled-runs:upsert', 'input.intervalMinutes', input.intervalMinutes, {
      integer: true,
      min: 5,
      max: 7 * 24 * 60
    });
    assertOptionalString('scheduled-runs:upsert', 'input.id', input.id);
    const run = await upsertScheduledRun(input);
    broadcastScheduledRunsUpdated(await listScheduledRuns());
    return run;
  });

  wrapIpcHandler(IPC.SCHEDULED_RUNS_DELETE, async (_event, id: string): Promise<{ ok: boolean }> => {
    assertString('scheduled-runs:delete', 'id', id);
    const ok = await deleteScheduledRun(id);
    if (ok) broadcastScheduledRunsUpdated(await listScheduledRuns());
    return { ok };
  });
}
