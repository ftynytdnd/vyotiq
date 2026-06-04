import { describe, expect, it } from 'vitest';
import {
  formatDelegateSpawnStatusLabel,
  resolveDelegateRoundConcurrency
} from '../../../src/main/orchestrator/delegateConcurrency.js';
import { HOST_DELEGATE_CONCURRENCY_CEILING } from '@shared/constants';

describe('formatDelegateSpawnStatusLabel', () => {
  it('shows total workers when all can run in parallel', () => {
    expect(formatDelegateSpawnStatusLabel(4, 4)).toBe('Spawning 4 workers…');
    expect(formatDelegateSpawnStatusLabel(4)).toBe('Spawning 4 workers…');
  });

  it('shows total and in-flight cap when workers queue', () => {
    expect(formatDelegateSpawnStatusLabel(4, 2)).toBe(
      'Spawning 4 workers (2 in flight)…'
    );
  });

  it('singularizes one worker', () => {
    expect(formatDelegateSpawnStatusLabel(1, 1)).toBe('Spawning 1 worker…');
  });
});

describe('resolveDelegateRoundConcurrency', () => {
  it('uses model-declared max across specs', () => {
    const specs = Array.from({ length: 12 }, (_, i) => ({
      id: `w${i}`,
      task: 't',
      files: [] as string[],
      tools: [] as string[],
      concurrency: i < 2 ? 12 : 4
    }));
    const n = resolveDelegateRoundConcurrency(specs, 64);
    expect(n).toBe(12);
  });

  it('falls back to provider cap when model omits concurrency', () => {
    expect(
      resolveDelegateRoundConcurrency([{ id: 'a', task: 't', files: [], tools: [] }], 8)
    ).toBe(1);
    expect(
      resolveDelegateRoundConcurrency([{ id: 'a', task: 't', files: [], tools: [] }])
    ).toBe(Math.min(1, HOST_DELEGATE_CONCURRENCY_CEILING));
  });

  it('clamps by provider max and spec count', () => {
    const specs = Array.from({ length: 20 }, (_, i) => ({
      id: `w${i}`,
      task: 't',
      files: [] as string[],
      tools: [] as string[],
      concurrency: 20
    }));
    expect(resolveDelegateRoundConcurrency(specs, 6)).toBe(6);
  });

  it('queues extras when model caps in-flight below spec count', () => {
    const specs = Array.from({ length: 8 }, (_, i) => ({
      id: `w${i}`,
      task: 't',
      files: [] as string[],
      tools: [] as string[],
      concurrency: 4
    }));
    expect(resolveDelegateRoundConcurrency(specs, 64)).toBe(4);
    expect(formatDelegateSpawnStatusLabel(8, 4)).toBe(
      'Spawning 8 workers (4 in flight)…'
    );
  });
});
