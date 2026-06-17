import { describe, expect, it } from 'vitest';
import {
  classifyPromptForPhasedMode,
  resolvePhasedModeActive
} from '../../../../src/main/orchestrator/phased/modeClassifier.js';

describe('classifyPromptForPhasedMode', () => {
  it('returns false for short / trivial prompts', () => {
    expect(classifyPromptForPhasedMode('hi')).toBe(false);
    expect(classifyPromptForPhasedMode('thanks')).toBe(false);
    expect(classifyPromptForPhasedMode('what is a closure?')).toBe(false);
    expect(classifyPromptForPhasedMode('how do I print in python?')).toBe(false);
  });

  it('returns true for multi-step build prompts', () => {
    expect(classifyPromptForPhasedMode('implement a new auth flow')).toBe(true);
    expect(classifyPromptForPhasedMode('refactor the database layer')).toBe(true);
    expect(classifyPromptForPhasedMode('write tests for the parser')).toBe(true);
  });

  it('treats long or multi-line prompts as multi-step', () => {
    expect(classifyPromptForPhasedMode('a'.repeat(200))).toBe(true);
    expect(classifyPromptForPhasedMode('line one\nline two\nline three')).toBe(true);
  });
});

describe('resolvePhasedModeActive', () => {
  it('honors never / always over classification', () => {
    expect(resolvePhasedModeActive('never', 'implement a refactor')).toBe(false);
    expect(resolvePhasedModeActive('always', 'hi')).toBe(true);
  });

  it('uses runtimeActive override when present in auto mode', () => {
    expect(resolvePhasedModeActive('auto', 'hi', true)).toBe(true);
    expect(resolvePhasedModeActive('auto', 'implement a refactor', false)).toBe(false);
  });

  it('falls back to the classifier in auto mode', () => {
    expect(resolvePhasedModeActive('auto', 'implement a refactor')).toBe(true);
    expect(resolvePhasedModeActive('auto', 'hi')).toBe(false);
  });
});
