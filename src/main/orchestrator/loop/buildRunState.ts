/**
 * Builds the `<run_state>` envelope — machine-readable summary of the run loop.
 */

import { wrapXml } from '../envelope/index.js';
import type { SpinSignatureBuffer } from './toolSpinSignature.js';
import { MAX_TOTAL_ITERATIONS } from '@shared/constants.js';

type LastAction =
  | 'none'
  | 'tool'
  | 'retry'
  | 'clarify'
  | 'answer';

export interface RunStateView {
  iteration: number;
  toolRounds: { total: number; consecutiveFailed: number };
  lastAction: LastAction;
  spinSignatureHot: string | null;
}

export function buildRunStateXml(view: RunStateView): string {
  const lines: string[] = [
    `iteration: ${view.iteration} of ${MAX_TOTAL_ITERATIONS}`,
    `tool_rounds: ${view.toolRounds.total} (consecutive_failed_tools: ${view.toolRounds.consecutiveFailed})`,
    `last_action: ${view.lastAction}`,
    `spin_signature_hot: ${view.spinSignatureHot ?? '(none)'}`
  ];
  return wrapXml('run_state', lines.join('\n'));
}

export interface RunStateAccumulator {
  iteration: number;
  toolRoundsTotal: number;
  lastAction: LastAction;
  spinSignatureHot: string | null;
}

export function createRunStateAccumulator(): RunStateAccumulator {
  return {
    iteration: 0,
    toolRoundsTotal: 0,
    lastAction: 'none',
    spinSignatureHot: null
  };
}

export function snapshotRunState(
  acc: RunStateAccumulator,
  _spin: SpinSignatureBuffer,
  consecutiveBadToolRounds: number
): RunStateView {
  return {
    iteration: acc.iteration,
    toolRounds: {
      total: acc.toolRoundsTotal,
      consecutiveFailed: consecutiveBadToolRounds
    },
    lastAction: acc.lastAction,
    spinSignatureHot: acc.spinSignatureHot
  };
}
