/**
 * Builds the `<run_state>` envelope — machine-readable summary of the run loop.
 */

import { wrapXml } from '../envelope/index.js';
import type { SpinSignatureBuffer } from './toolSpinSignature.js';

type LastAction =
  | 'none'
  | 'tool'
  | 'retry'
  | 'clarify'
  | 'answer';

export interface RunStateView {
  iteration: number;
  maxIterations: number;
  toolRounds: { total: number; consecutiveFailed: number };
  lastAction: LastAction;
  spinSignatureHot: string | null;
  toolRecoveryCycles: number;
  continueWithoutProgress: number;
}

export function buildRunStateXml(view: RunStateView): string {
  const lines: string[] = [
    `iteration: ${view.iteration} of ${view.maxIterations}`,
    `tool_rounds: ${view.toolRounds.total} (consecutive_failed_tools: ${view.toolRounds.consecutiveFailed})`,
    `last_action: ${view.lastAction}`,
    `spin_signature_hot: ${view.spinSignatureHot ?? '(none)'}`,
    `tool_recovery_cycles: ${view.toolRecoveryCycles}`,
    `continue_without_progress: ${view.continueWithoutProgress}`
  ];
  return wrapXml('run_state', lines.join('\n'));
}

export interface RunStateAccumulator {
  iteration: number;
  toolRoundsTotal: number;
  lastAction: LastAction;
  spinSignatureHot: string | null;
  toolRecoveryCycles: number;
  continueWithoutProgress: number;
}

export function createRunStateAccumulator(): RunStateAccumulator {
  return {
    iteration: 0,
    toolRoundsTotal: 0,
    lastAction: 'none',
    spinSignatureHot: null,
    toolRecoveryCycles: 0,
    continueWithoutProgress: 0
  };
}

export function snapshotRunState(
  acc: RunStateAccumulator,
  _spin: SpinSignatureBuffer,
  consecutiveBadToolRounds: number,
  maxIterations: number
): RunStateView {
  return {
    iteration: acc.iteration,
    maxIterations,
    toolRounds: {
      total: acc.toolRoundsTotal,
      consecutiveFailed: consecutiveBadToolRounds
    },
    lastAction: acc.lastAction,
    spinSignatureHot: acc.spinSignatureHot,
    toolRecoveryCycles: acc.toolRecoveryCycles,
    continueWithoutProgress: acc.continueWithoutProgress
  };
}
