/**
 * Model-declared mixed-turn dispatcher. Replaces the fixed
 * continue-tools-first-then-delegates ordering with a topological
 * executor: independent tool calls and delegate batches run in
 * parallel; `depends_on` edges force sequential batches.
 */

import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { ParsedDelegate } from '../envelope/index.js';
import {
  batchIndicesByDependencies,
  dependsOnFromArgumentsBuf
} from './toolDependencyBatches.js';
import { handleToolCalls, type HandleToolCallsResult } from './handleToolCalls.js';
import { handleDelegates, type DelegationCounters } from './handleDelegates.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import type { HandleDelegatesOpts } from './handleDelegates.js';
import type { HandleToolCallsOpts } from './handleToolCalls.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orch/dispatch');

export interface DelegateToolCall {
  toolCallId: string;
  specs: ParsedDelegate[];
  dependsOn: string[];
}

export interface DispatchMixedTurnOpts {
  continueTools: PartialToolCall[];
  delegateCalls: DelegateToolCall[];
  messages: ChatMessage[];
  counters: DelegationCounters;
  emit: (event: TimelineEvent) => void;
  toolOpts: Omit<HandleToolCallsOpts, 'allowlist'> & { allowlist: readonly string[] };
  delegateOpts: HandleDelegatesOpts;
}

export interface DispatchMixedTurnResult {
  didWork: boolean;
  directToolRounds: number;
  delegateRounds: number;
  halt?: true;
  lastDirectToolSummary?: HandleToolCallsResult;
}

interface DispatchNode {
  id: string;
  dependsOn: string[];
  kind: 'tool' | 'delegate';
  tools?: PartialToolCall[];
  delegateSpecs?: ParsedDelegate[];
}

function buildNodes(
  continueTools: PartialToolCall[],
  delegateCalls: DelegateToolCall[]
): DispatchNode[] {
  const nodes: DispatchNode[] = [];
  for (const tc of continueTools) {
    nodes.push({
      id: tc.id!,
      dependsOn: dependsOnFromArgumentsBuf(tc.argumentsBuf),
      kind: 'tool',
      tools: [tc]
    });
  }
  for (const dc of delegateCalls) {
    nodes.push({
      id: dc.toolCallId,
      dependsOn: dc.dependsOn,
      kind: 'delegate',
      delegateSpecs: dc.specs
    });
  }
  return nodes;
}

export async function dispatchMixedTurn(
  opts: DispatchMixedTurnOpts
): Promise<DispatchMixedTurnResult> {
  const nodes = buildNodes(opts.continueTools, opts.delegateCalls);
  if (nodes.length === 0) {
    return { didWork: false, directToolRounds: 0, delegateRounds: 0 };
  }

  const batches = batchIndicesByDependencies(
    nodes.map((n) => ({ id: n.id, dependsOn: n.dependsOn }))
  );

  log.debug('mixed-turn dispatch batches', {
    nodes: nodes.length,
    batches: batches.length
  });

  let didWork = false;
  let directToolRounds = 0;
  let delegateRounds = 0;
  let lastDirectToolSummary: HandleToolCallsResult | undefined;

  for (const batch of batches) {
    if (opts.toolOpts.signal.aborted) break;

    const batchNodes = batch.map((i) => nodes[i]!);
    const toolCalls = batchNodes.flatMap((n) => (n.kind === 'tool' ? n.tools ?? [] : []));
    const delegateSpecs = batchNodes.flatMap((n) =>
      n.kind === 'delegate' ? n.delegateSpecs ?? [] : []
    );

    const tasks: Promise<'halt' | void>[] = [];

    if (toolCalls.length > 0) {
      tasks.push(
        (async () => {
          const summary = await handleToolCalls(toolCalls, opts.messages, opts.emit, {
            ...opts.toolOpts,
            skipDependencyBatching: true
          });
          lastDirectToolSummary = summary;
          directToolRounds += 1;
          didWork = true;
        })()
      );
    }

    if (delegateSpecs.length > 0) {
      tasks.push(
        (async () => {
          const outcome = await handleDelegates(
            delegateSpecs,
            opts.messages,
            opts.counters,
            opts.emit,
            opts.delegateOpts
          );
          delegateRounds += 1;
          didWork = true;
          if (outcome === 'halt') return 'halt';
        })()
      );
    }

    const results = await Promise.all(tasks);
    if (results.includes('halt')) {
      return {
        didWork,
        directToolRounds,
        delegateRounds,
        halt: true,
        lastDirectToolSummary
      };
    }
    if (opts.toolOpts.signal.aborted) break;
  }

  return { didWork, directToolRounds, delegateRounds, lastDirectToolSummary };
}
