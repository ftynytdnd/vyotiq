import { describe, expect, it } from 'vitest';
import {
  batchIndicesByDependencies,
  parseDependsOnIds
} from '../../../../src/main/orchestrator/loop/toolDependencyBatches.js';

describe('toolDependencyBatches', () => {
  it('parseDependsOnIds accepts array and csv', () => {
    expect(parseDependsOnIds({ depends_on: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(parseDependsOnIds({ dependsOn: 'x, y' })).toEqual(['x', 'y']);
  });

  it('batches independent calls in one group', () => {
    const plan = batchIndicesByDependencies([
      { id: '1', dependsOn: [] },
      { id: '2', dependsOn: [] },
      { id: '3', dependsOn: [] }
    ]);
    expect(plan.batches).toEqual([[0, 1, 2]]);
    expect(plan.deadlockIndices).toEqual([]);
  });

  it('respects depends_on ordering', () => {
    const plan = batchIndicesByDependencies([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] }
    ]);
    expect(plan.batches).toEqual([[0], [1], [2]]);
    expect(plan.deadlockIndices).toEqual([]);
  });

  it('returns deadlock indices instead of flushing a parallel batch', () => {
    const plan = batchIndicesByDependencies([
      { id: 'a', dependsOn: ['b'] },
      { id: 'b', dependsOn: ['a'] }
    ]);
    expect(plan.batches).toEqual([]);
    expect(plan.deadlockIndices).toEqual([0, 1]);
  });
});
