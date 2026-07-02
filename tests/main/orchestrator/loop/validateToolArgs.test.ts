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
    expect(validateToolArgs('edit', { path: 'src/foo.ts', oldString: 'a', newString: 'b' }).ok).toBe(true);
  });

  it('requires command for bash and query, pattern, or kind for search', () => {
    expect(validateToolArgs('bash', {}).ok).toBe(false);
    expect(validateToolArgs('search', {}).ok).toBe(false);
    expect(validateToolArgs('bash', { command: 'ls' }).ok).toBe(true);
    expect(validateToolArgs('search', { query: 'foo' }).ok).toBe(true);
    expect(validateToolArgs('search', { kind: 'function_declaration' }).ok).toBe(true);
    expect(validateToolArgs('search', { query: 'foo', mode: 'web' }).ok).toBe(true);
    expect(
      validateToolArgs('search', {
        query: 'export function $NAME',
        language: 'typescript'
      }).ok
    ).toBe(true);
  });

  it('requires rulePath or configPath for sg scan', () => {
    expect(validateToolArgs('sg', { action: 'scan' }).ok).toBe(false);
    expect(validateToolArgs('sg', { action: 'scan', rulePath: 'rules/a.yml' }).ok).toBe(true);
    expect(validateToolArgs('sg', { action: 'scan', configPath: 'sgconfig.yml' }).ok).toBe(true);
    expect(validateToolArgs('sg', { action: 'test' }).ok).toBe(true);
  });

  it('requires action and scope for memory', () => {
    expect(validateToolArgs('memory', {}).ok).toBe(false);
    expect(validateToolArgs('memory', { action: 'list' }).ok).toBe(false);
    expect(validateToolArgs('memory', { action: 'list', scope: 'workspace' }).ok).toBe(true);
  });

  it('requires target for capture and sourceId when target is screen', () => {
    expect(validateToolArgs('capture', {}).ok).toBe(false);
    expect(validateToolArgs('capture', { target: 'browser' }).ok).toBe(true);
    expect(validateToolArgs('capture', { target: 'window' }).ok).toBe(true);
    expect(validateToolArgs('capture', { target: 'screen' }).ok).toBe(false);
    expect(
      validateToolArgs('capture', { target: 'screen', sourceId: 'screen:0' }).ok
    ).toBe(true);
  });

  it('requires title and body for report', () => {
    expect(validateToolArgs('report', {}).ok).toBe(false);
    expect(validateToolArgs('report', { title: 'Audit' }).ok).toBe(false);
    expect(validateToolArgs('report', { title: 'Audit', body: '<p>ok</p>' }).ok).toBe(true);
  });

  it('requires action for recall and conversationId for read', () => {
    expect(validateToolArgs('recall', {}).ok).toBe(false);
    expect(validateToolArgs('recall', { action: 'list' }).ok).toBe(true);
    expect(validateToolArgs('recall', { action: 'read' }).ok).toBe(false);
    expect(
      validateToolArgs('recall', { action: 'read', conversationId: 'conv-1' }).ok
    ).toBe(true);
  });

  it('passes through tools without required-arg guards', () => {
    expect(validateToolArgs('ls', {}).ok).toBe(true);
  });

  it('validates context list/load and pack ids', () => {
    expect(validateToolArgs('context', {}).ok).toBe(false);
    expect(validateToolArgs('context', { action: 'list' }).ok).toBe(true);
    expect(validateToolArgs('context', { action: 'load' }).ok).toBe(false);
    expect(validateToolArgs('context', { action: 'load', pack: 'static-examples' }).ok).toBe(true);
    expect(validateToolArgs('context', { action: 'load', pack: 'not-a-pack' }).ok).toBe(true);
  });

  it('allows todos read calls with no todos array', () => {
    expect(validateToolArgs('todos', {}).ok).toBe(true);
  });

  it('rejects malformed todos writes before dispatch', () => {
    expect(validateToolArgs('todos', { todos: 'bad' }).ok).toBe(false);
    expect(validateToolArgs('todos', { todos: [{}] }).ok).toBe(false);
    expect(validateToolArgs('todos', { todos: [{ id: '1', content: 'x', status: 'nope' }] }).ok).toBe(
      false
    );
    expect(
      validateToolArgs('todos', {
        todos: [{ id: '1', content: 'Read auth module', status: 'in_progress' }]
      }).ok
    ).toBe(true);
  });

  it('validates nested todos parentId and rejects self-parent', () => {
    expect(
      validateToolArgs('todos', {
        todos: [
          { id: 'p', content: 'Phase', status: 'pending' },
          { id: 's', parentId: 'p', content: 'Step', status: 'pending' }
        ]
      }).ok
    ).toBe(true);
    expect(
      validateToolArgs('todos', {
        todos: [{ id: 'x', parentId: 'x', content: 'Self', status: 'pending' }]
      }).ok
    ).toBe(false);
    expect(
      validateToolArgs('todos', {
        todos: [{ id: 'x', parentId: '  ', content: 'Bad parent', status: 'pending' }]
      }).ok
    ).toBe(false);
  });

  it('validates ls path and depth', () => {
    expect(validateToolArgs('ls', {}).ok).toBe(true);
    expect(validateToolArgs('ls', { path: '  ' }).ok).toBe(false);
    expect(validateToolArgs('ls', { depth: -1 }).ok).toBe(false);
    expect(validateToolArgs('ls', { path: 'src', depth: 2 }).ok).toBe(true);
  });

  it('validates heartbeat action and attach interval', () => {
    expect(validateToolArgs('heartbeat', { action: 'nope' }).ok).toBe(false);
    expect(validateToolArgs('heartbeat', { action: 'attach' }).ok).toBe(false);
    expect(validateToolArgs('heartbeat', { action: 'attach', intervalMinutes: 7 }).ok).toBe(
      true
    );
    expect(validateToolArgs('heartbeat', { action: 'detach' }).ok).toBe(true);
  });

  it('validates continue optional prompt', () => {
    expect(validateToolArgs('continue', {}).ok).toBe(true);
    expect(validateToolArgs('continue', { prompt: '  ' }).ok).toBe(false);
    expect(validateToolArgs('continue', { prompt: 'keep going' }).ok).toBe(true);
  });

  it('accepts finish and ask_user without extra args', () => {
    expect(validateToolArgs('finish', {}).ok).toBe(true);
    expect(validateToolArgs('ask_user', { question: 'Pick one' }).ok).toBe(true);
  });

  it('passes unknown tool names through without validation', () => {
    expect(validateToolArgs('not_a_tool', { anything: true }).ok).toBe(true);
  });
});
