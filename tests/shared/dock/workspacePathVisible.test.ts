/**
 * workspacePathVisible — path subtitle only when basename differs from label.
 */

import { describe, expect, it } from 'vitest';
import { workspacePathVisible } from '@renderer/components/dock/dockShared';

describe('workspacePathVisible', () => {
  it('hides path when folder basename matches workspace label', () => {
    expect(workspacePathVisible('Codex', 'C:\\Users\\admin\\Documents\\Codex')).toBe(false);
    expect(workspacePathVisible('agent', '/home/dev/agent')).toBe(false);
  });

  it('shows path when basename differs from label', () => {
    expect(workspacePathVisible('Work', 'C:\\Users\\admin\\Documents\\Codex')).toBe(true);
  });

  it('returns false for empty path', () => {
    expect(workspacePathVisible('agent', '')).toBe(false);
  });
});
