/**

 * Queued follow-up consumption before terminal finish.

 */



import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createRunStateAccumulator } from '@main/orchestrator/loop/buildRunState.js';

import { createSpinSignatureBuffer } from '@main/orchestrator/loop/toolSpinSignature.js';

import type { ChatMessage } from '@shared/types/chat.js';

import type { FollowUpMessage } from '@shared/types/followUp.js';



const takeQueuedFollowUpMock = vi.hoisted(() => vi.fn());

const takeSteeringFollowUpMock = vi.hoisted(() => vi.fn());

const injectFollowUpMock = vi.hoisted(() =>

  vi.fn(async () => ({ userEnvelope: '<turn/>', promptEventId: 'e1', query: 'queued task' }))

);



vi.mock('@main/followUps/followUpQueueService.js', () => ({

  takeQueuedFollowUp: (...args: unknown[]) => takeQueuedFollowUpMock(...args),

  takeSteeringFollowUp: (...args: unknown[]) => takeSteeringFollowUpMock(...args)

}));



vi.mock('@main/orchestrator/followUps/injectFollowUp.js', () => ({

  injectFollowUp: (...args: unknown[]) => injectFollowUpMock(...args)

}));



import {

  consumeSteeringFollowUps,

  tryConsumeQueueBeforeFinish

} from '@main/orchestrator/followUps/followUpLoopHooks.js';



function queuedItem(): FollowUpMessage {

  return {

    id: 'q-1',

    kind: 'queue',

    prompt: 'queued task',

    selection: { providerId: 'p1', modelId: 'm1' },

    queuedAt: Date.now(),

    source: 'composer'

  };

}



function loopCtx(messages: ChatMessage[] = []) {

  return {

    runId: 'run-1',

    conversationId: 'conv-1',

    workspacePath: '/tmp/ws',

    workspaceId: 'ws-1',

    emit: vi.fn(),

    messages,

    runStateAcc: createRunStateAccumulator(),

    spin: createSpinSignatureBuffer()

  };

}



describe('tryConsumeQueueBeforeFinish', () => {

  beforeEach(() => {

    takeQueuedFollowUpMock.mockReset();

    takeSteeringFollowUpMock.mockReset();

    injectFollowUpMock.mockClear();

  });



  it('returns undefined when no queued follow-up is pending', async () => {

    takeQueuedFollowUpMock.mockResolvedValue(undefined);



    const result = await tryConsumeQueueBeforeFinish(loopCtx());



    expect(result).toBeUndefined();

    expect(injectFollowUpMock).not.toHaveBeenCalled();

  });



  it('injects the head queued item and returns query + selection', async () => {

    const item = queuedItem();

    takeQueuedFollowUpMock.mockResolvedValue(item);

    const runStateAcc = createRunStateAccumulator();

    runStateAcc.lastAction = 'tool';



    const result = await tryConsumeQueueBeforeFinish({ ...loopCtx(), runStateAcc });



    expect(result).toEqual({

      query: 'queued task',

      selection: { providerId: 'p1', modelId: 'm1' }

    });

    expect(injectFollowUpMock).toHaveBeenCalledWith(

      expect.objectContaining({

        followUp: item,

        runId: 'run-1',

        conversationId: 'conv-1'

      })

    );

    expect(runStateAcc.lastAction).toBe('none');

  });

});



describe('consumeSteeringFollowUps', () => {

  beforeEach(() => {

    takeSteeringFollowUpMock.mockReset();

    injectFollowUpMock.mockClear();

  });



  it('consumes one steering item per checkpoint', async () => {

    const item: FollowUpMessage = {

      ...queuedItem(),

      id: 's-1',

      kind: 'steering',

      prompt: 'steer now'

    };

    takeSteeringFollowUpMock.mockResolvedValue(item);

    injectFollowUpMock.mockResolvedValue({

      userEnvelope: '<turn/>',

      promptEventId: 'e2',

      query: 'steer now'

    });



    const result = await consumeSteeringFollowUps(loopCtx());



    expect(takeSteeringFollowUpMock).toHaveBeenCalledTimes(1);

    expect(result).toEqual({

      query: 'steer now',

      selection: { providerId: 'p1', modelId: 'm1' }

    });

  });

});

