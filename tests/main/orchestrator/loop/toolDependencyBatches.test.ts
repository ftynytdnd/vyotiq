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
    const batches = batchIndicesByDependencies([
      { id: '1', dependsOn: [] },
      { id: '2', dependsOn: [] },
      { id: '3', dependsOn: [] }
    ]);
    expect(batches).toEqual([[0, 1, 2]]);
  });

  it('respects depends_on ordering', () => {
    const batches = batchIndicesByDependencies([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] }
    ]);
    expect(batches).toEqual([[0], [1], [2]]);
  });
});
