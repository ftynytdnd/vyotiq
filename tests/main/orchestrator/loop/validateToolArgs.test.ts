import { describe, expect, it } from 'vitest';
import { validateToolArgs } from '@main/orchestrator/loop/validateToolArgs';

describe('validateToolArgs', () => {
  it('requires path for read', () => {
    const r = validateToolArgs('read', {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('missing path');
      expect(r.output).toContain('path');
    }
  });

  it('requires path for edit and delete', () => {
    expect(validateToolArgs('edit', { path: '  ' }).ok).toBe(false);
    expect(validateToolArgs('delete', {}).ok).toBe(false);
    expect(validateToolArgs('edit', { path: 'src/foo.ts' }).ok).toBe(true);
  });

  it('requires command for bash and query+mode for search', () => {
    expect(validateToolArgs('bash', {}).ok).toBe(false);
    expect(validateToolArgs('search', {}).ok).toBe(false);
    expect(validateToolArgs('bash', { command: 'ls' }).ok).toBe(true);
    expect(validateToolArgs('search', { query: 'foo' }).ok).toBe(false);
    expect(validateToolArgs('search', { query: 'foo', mode: 'local' }).ok).toBe(true);
    expect(validateToolArgs('search', { query: 'foo', mode: 'web' }).ok).toBe(false);
    expect(
      validateToolArgs('search', { query: 'export function $NAME', mode: 'structural' }).ok
    ).toBe(false);
    expect(
      validateToolArgs('search', {
        query: 'export function $NAME',
        mode: 'structural',
        language: 'typescript'
      }).ok
    ).toBe(true);
  });

  it('requires action and scope for memory', () => {
    expect(validateToolArgs('memory', {}).ok).toBe(false);
    expect(validateToolArgs('memory', { action: 'list' }).ok).toBe(false);
    expect(validateToolArgs('memory', { action: 'list', scope: 'workspace' }).ok).toBe(true);
  });

  it('passes through tools without required-arg guards', () => {
    expect(validateToolArgs('ls', {}).ok).toBe(true);
  });
});
