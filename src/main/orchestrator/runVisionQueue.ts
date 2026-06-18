/**

 * Run-scoped queue for workspace vision paths discovered by tools (read, capture).

 * Flushed into a synthetic user message before the next assistant turn.

 */



import type { ChatMessage } from '@shared/types/chat.js';

import type { AttachmentMediaKind } from '@shared/types/chat.js';

import type { ModelInputModality, ModelSelection } from '@shared/types/provider.js';

import { mediaKindFromMeta, guessMimeFromName } from '@shared/attachments/mediaKind.js';

import { prepareVisionParts } from '../attachments/prepareMediaForVision.js';

import type { PreparedMediaCache } from '../attachments/preparedMediaCache.js';

import { wrapXml } from './envelope/index.js';



export interface QueuedWorkspaceVision {

  path: string;

  kind: AttachmentMediaKind;

  source: 'read' | 'capture' | 'mention';

}



interface RunVisionQueueState {

  items: QueuedWorkspaceVision[];

}



const queues = new Map<string, RunVisionQueueState>();



function itemKey(item: QueuedWorkspaceVision): string {

  return `${item.path}:${item.kind}`;

}



function restoreVisionQueue(runId: string, items: QueuedWorkspaceVision[]): void {

  if (items.length === 0) return;

  let state = queues.get(runId);

  if (!state) {

    queues.set(runId, { items: [...items] });

    return;

  }

  const existing = new Set(state.items.map(itemKey));

  for (const item of items) {

    const key = itemKey(item);

    if (!existing.has(key)) {

      state.items.push(item);

      existing.add(key);

    }

  }

}



export function queueWorkspaceVision(

  runId: string,

  item: QueuedWorkspaceVision

): void {

  let state = queues.get(runId);

  if (!state) {

    state = { items: [] };

    queues.set(runId, state);

  }

  const key = itemKey(item);

  if (!state.items.some((i) => itemKey(i) === key)) {

    state.items.push(item);

  }

}



export function clearRunVisionQueue(runId: string): void {

  queues.delete(runId);

}



export interface FlushVisionQueueInput {

  runId: string;

  workspacePath: string;

  selection: ModelSelection;

  inputModalities?: ModelInputModality[];

  mediaCache?: PreparedMediaCache;

  signal?: AbortSignal;

}



/**

 * Build a synthetic user message from queued workspace vision items.

 * Consumes prepared items from the queue; restores skipped or failed items.

 */

export async function flushVisionQueue(

  input: FlushVisionQueueInput

): Promise<ChatMessage | null> {

  const state = queues.get(input.runId);

  if (!state || state.items.length === 0) return null;

  const items = state.items.splice(0);

  if (state.items.length === 0) queues.delete(input.runId);



  const attachmentMeta = items.map((item, idx) => ({

    id: `tool-vision-${idx}`,

    name: item.path.split(/[/\\]/).pop() ?? item.path,

    mimeType: guessMimeFromName(item.path),

    mediaKind: item.kind,

    workspacePath: item.path

  }));



  let parts;

  let preparedWorkspacePaths: string[];

  try {

    const prepared = await prepareVisionParts({

      attachmentMeta,

      workspacePath: input.workspacePath,

      inputModalities: input.inputModalities,

      cache: input.mediaCache,

      cacheKeyPrefix: input.runId,

      signal: input.signal

    });

    parts = prepared.parts;

    preparedWorkspacePaths = prepared.preparedWorkspacePaths;

  } catch (err) {

    restoreVisionQueue(input.runId, items);

    throw err;

  }



  const preparedSet = new Set(preparedWorkspacePaths);

  const sentItems = items.filter((item) => preparedSet.has(item.path));

  const skippedItems = items.filter((item) => !preparedSet.has(item.path));



  if (sentItems.length === 0) {

    restoreVisionQueue(input.runId, items);

    return null;

  }



  if (skippedItems.length > 0) {

    restoreVisionQueue(input.runId, skippedItems);

  }



  const refs = sentItems

    .map(

      (item) =>

        `<vision_ref path="${item.path.replace(/"/g, '&quot;')}" source="${item.source}" kind="${item.kind}" />`

    )

    .join('\n');

  const body = wrapXml('tool_vision', refs, undefined, { escape: true });

  const turnXml = wrapXml('turn', body);



  return {

    role: 'user',

    content: [...parts, { type: 'text', text: turnXml }]

  };

}



export function mediaKindFromWorkspacePath(path: string): AttachmentMediaKind {

  return mediaKindFromMeta({ name: path });

}


