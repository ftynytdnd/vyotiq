/**
 * Virtualization-aware navigation helpers for turn-based timeline scrolling.
 */

import type { DisplayRow } from './displayRowTypes.js';

export function findTurnIndexForRowKey(
  turnSegments: DisplayRow[][],
  rowKey: string
): number {
  return turnSegments.findIndex((segment) => segment.some((row) => row.key === rowKey));
}

/** Turn indices that contain a user prompt row (for g+j / g+k navigation). */
export function promptTurnIndices(turnSegments: DisplayRow[][]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < turnSegments.length; i++) {
    if (turnSegments[i]!.some((row) => row.kind === 'user-prompt')) {
      indices.push(i);
    }
  }
  return indices;
}
