import { describe, expect, it } from 'vitest';
import {
  clearsDynamicLoopAuditAwaiting,
  shouldInjectDynamicLoopAudit,
  DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT,
  DEFAULT_DYNAMIC_LOOP_CONTINUE_PROMPT
} from '@main/orchestrator/loop/dynamicLoopAudit.js';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn.js';

function tc(name: string, args: Record<string, unknown> = {}): PartialToolCall {
  return { id: 'x', name, argumentsBuf: JSON.stringify(args) };
}

describe('dynamicLoopAudit', () => {
  it('exports default prompts', () => {
    expect(DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT).toContain('<dynamic_loop_audit>');
    expect(DEFAULT_DYNAMIC_LOOP_CONTINUE_PROMPT).toContain('<dynamic_loop_continue>');
  });

  it('injects after edit/delete without terminal calls', () => {
    expect(shouldInjectDynamicLoopAudit([tc('edit')], [], false)).toBe(true);
    expect(shouldInjectDynamicLoopAudit([tc('delete')], [], false)).toBe(true);
  });

  it('does not treat generic bash alone as substantive', () => {
    expect(shouldInjectDynamicLoopAudit([tc('bash', { command: 'ls -la' })], [], false)).toBe(
      false
    );
  });

  it('treats bash test/build commands as substantive', () => {
    expect(
      shouldInjectDynamicLoopAudit([tc('bash', { command: 'pnpm vitest run' })], [], false)
    ).toBe(true);
  });

  it('skips read-only rounds', () => {
    expect(shouldInjectDynamicLoopAudit([tc('read'), tc('search')], [], false)).toBe(
      false
    );
  });

  it('skips when awaiting audit response', () => {
    expect(shouldInjectDynamicLoopAudit([tc('edit')], [], true)).toBe(false);
  });

  it('skips when agent already called continue', () => {
    expect(shouldInjectDynamicLoopAudit([tc('edit'), tc('continue')], [], false)).toBe(
      false
    );
  });

  it('skips when ask_user is present', () => {
    expect(shouldInjectDynamicLoopAudit([tc('edit')], [tc('ask_user')], false)).toBe(false);
  });

  it('skips finish-only turns without substantive tools', () => {
    expect(shouldInjectDynamicLoopAudit([], [tc('finish')], false)).toBe(false);
  });

  it('allows audit when finish is co-emitted with edit', () => {
    expect(shouldInjectDynamicLoopAudit([tc('edit')], [tc('edit'), tc('finish')], false)).toBe(
      true
    );
  });

  it('clears awaiting flag on substantive tools or continue', () => {
    expect(clearsDynamicLoopAuditAwaiting([tc('edit')])).toBe(true);
    expect(clearsDynamicLoopAuditAwaiting([tc('continue')])).toBe(true);
    expect(clearsDynamicLoopAuditAwaiting([tc('read')])).toBe(false);
  });
});
