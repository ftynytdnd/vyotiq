import { describe, expect, it } from 'vitest';
import { assertSafeRelativePath } from '../../../src/main/workspace/workspacePathGuards.js';

describe('workspacePathGuards', () => {
  it('blocks .vyotiq paths by default', () => {
    expect(() =>
      assertSafeRelativePath('test', 'path', '.vyotiq/config.json')
    ).toThrow(/cannot modify/);
  });

  it('allows .vyotiq paths when allowDotVyotiq is set', () => {
    expect(() =>
      assertSafeRelativePath('test', 'path', '.vyotiq/config.json', { allowDotVyotiq: true })
    ).not.toThrow();
  });
});
