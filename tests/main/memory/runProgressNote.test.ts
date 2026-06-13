import { describe, expect, it } from 'vitest';
import {
  isPerConversationRunProgressKey,
  isRunProgressKey,
  resolveRunProgressKey,
  runProgressStorageKey,
  RUN_PROGRESS_AGENT_KEY
} from '@main/memory/runProgressNote.js';

describe('runProgressNote', () => {
  it('maps agent key to per-conversation storage key', () => {
    const conv = '3d019e40-56db-4924-b637-c98e52b9a534';
    expect(runProgressStorageKey(conv)).toBe(`${RUN_PROGRESS_AGENT_KEY}-${conv}`);
    expect(resolveRunProgressKey(RUN_PROGRESS_AGENT_KEY, conv)).toBe(
      runProgressStorageKey(conv)
    );
  });

  it('passes through unrelated keys', () => {
    expect(resolveRunProgressKey('project-structure', 'conv-id')).toBe('project-structure');
  });

  it('detects run-progress keys for retrieval exclusion', () => {
    expect(isRunProgressKey(RUN_PROGRESS_AGENT_KEY)).toBe(true);
    expect(isRunProgressKey('run-progress-abc')).toBe(true);
    expect(isPerConversationRunProgressKey('run-progress-abc')).toBe(true);
    expect(isRunProgressKey('project-structure')).toBe(false);
  });
});
