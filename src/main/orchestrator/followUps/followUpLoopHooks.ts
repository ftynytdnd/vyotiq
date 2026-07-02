/**

 * Run-loop hooks for steering and queued follow-up injection.

 */



import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';

import type { FollowUpMessage } from '@shared/types/followUp.js';

import type { ModelSelection } from '@shared/types/provider.js';

import { takeQueuedFollowUp, takeSteeringFollowUp } from '../../followUps/followUpQueueService.js';

import { injectFollowUp } from './injectFollowUp.js';

import { resetSpinBuffer } from '../loop/toolSpinSignature.js';

import type { RunStateAccumulator } from '../loop/buildRunState.js';

import { logger } from '../../logging/logger.js';



const log = logger.child('follow-ups/loop-hooks');



export interface FollowUpLoopCtx {

  runId: string;

  conversationId: string;

  workspacePath: string;

  workspaceId: string;

  emit: (event: TimelineEvent) => void;

  messages: ChatMessage[];

  signal?: AbortSignal;

  runStateAcc: RunStateAccumulator;

  spin: ReturnType<typeof import('../loop/toolSpinSignature.js').createSpinSignatureBuffer>;

}



export interface FollowUpInjectResult {

  query: string;

  selection: ModelSelection;
  invokedSkill?: string;
}



async function injectOne(

  ctx: FollowUpLoopCtx,

  item: FollowUpMessage

): Promise<FollowUpInjectResult> {

  const result = await injectFollowUp({

    followUp: item,

    runId: ctx.runId,

    conversationId: ctx.conversationId,

    workspacePath: ctx.workspacePath,

    workspaceId: ctx.workspaceId,

    emit: ctx.emit,

    messages: ctx.messages,

    signal: ctx.signal

  });

  ctx.runStateAcc.lastAction = 'none';

  resetSpinBuffer(ctx.spin);

  log.info('injected follow-up mid-loop', {

    runId: ctx.runId,

    kind: item.kind,

    followUpId: item.id

  });

  return { query: result.query, selection: { ...item.selection }, invokedSkill: item.invokedSkill };

}



/** Consume one pending steering item after an assistant stream segment. */

export async function consumeSteeringFollowUps(

  ctx: FollowUpLoopCtx

): Promise<FollowUpInjectResult | undefined> {

  if (!ctx.conversationId) return undefined;

  const head = await takeSteeringFollowUp(ctx.conversationId);

  if (!head) return undefined;

  return injectOne(ctx, head);

}



/**

 * Before terminal finish, inject the head queued item and return true so the

 * loop should continue instead of finishing.

 */

export async function tryConsumeQueueBeforeFinish(

  ctx: FollowUpLoopCtx

): Promise<FollowUpInjectResult | undefined> {

  if (!ctx.conversationId) return undefined;

  const head = await takeQueuedFollowUp(ctx.conversationId);

  if (!head) return undefined;

  return injectOne(ctx, head);

}

