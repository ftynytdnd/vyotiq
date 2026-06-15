/**
 * Git decoration class helpers for dock file tree rows.
 */

import { describe, expect, it } from 'vitest';
import {
  gitStatusAriaLabel,
  gitStatusBadgeClass,
  gitStatusBadgeCn,
  gitStatusNameClass
} from '@renderer/lib/dockGitTreeStyle';

describe('dockGitTreeStyle', () => {
  it('returns empty name class for null/undefined', () => {
    expect(gitStatusNameClass(null)).toBe('');
    expect(gitStatusNameClass(undefined)).toBe('');
  });

  it('maps git statuses to label classes', () => {
    expect(gitStatusNameClass('M')).toContain('text-warning');
    expect(gitStatusNameClass('A')).toContain('text-success');
    expect(gitStatusNameClass('D')).toContain('line-through');
    expect(gitStatusNameClass('U')).toContain('text-danger');
    expect(gitStatusNameClass('?')).toContain('italic');
    expect(gitStatusNameClass('R')).toContain('text-accent');
  });

  it('maps git statuses to badge classes', () => {
    expect(gitStatusBadgeClass('M')).toContain('warning');
    expect(gitStatusBadgeClass('A')).toContain('success');
    expect(gitStatusBadgeClass('?')).toContain('text-text-muted');
  });

  it('returns aria labels', () => {
    expect(gitStatusAriaLabel('M')).toBe('Modified');
    expect(gitStatusAriaLabel('A')).toBe('Added');
    expect(gitStatusAriaLabel('?')).toBe('Untracked');
  });

  it('composes badge cn only when status present', () => {
    expect(gitStatusBadgeCn(null)).toBe('');
    expect(gitStatusBadgeCn('M')).toContain('font-mono');
    expect(gitStatusBadgeCn('M')).toContain(gitStatusBadgeClass('M'));
  });
});
