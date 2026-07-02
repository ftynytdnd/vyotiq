import { describe, expect, it } from 'vitest';
import {
  clearsDynamicLoopAuditAwaiting,
  shouldInjectDynamicLoopAudit,
  DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT,
  ENHANCED_DYNAMIC_LOOP_AUDIT_PROMPT,
  DEFAULT_DYNAMIC_LOOP_CONTINUE_PROMPT,
  runHasUnverifiedSubstantiveEdits,
  resolveDynamicLoopAuditPrompt,
  MIN_EDITS_BEFORE_UNVERIFIED_AUDIT
} from '@main/orchestrator/loop/dynamicLoopAudit.js';
import type { ChatMessage } from '@shared/types/chat.js';
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

  it('detects multiple edits without verify bash in run history', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: '1',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"a.ts"}' }
          }
        ]
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: '2',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"b.ts"}' }
          }
        ]
      }
    ];
    expect(runHasUnverifiedSubstantiveEdits(messages)).toBe(true);
    expect(MIN_EDITS_BEFORE_UNVERIFIED_AUDIT).toBe(2);
  });

  it('clears unverified flag after test bash in history', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: '1',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"a.ts"}' }
          },
          {
            id: '2',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"b.ts"}' }
          },
          {
            id: '3',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"pnpm vitest run"}' }
          }
        ]
      }
    ];
    expect(runHasUnverifiedSubstantiveEdits(messages)).toBe(false);
  });

  it('injects audit on finish-only after unverified edit history', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: '1',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"a.ts"}' }
          }
        ]
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: '2',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"b.ts"}' }
          }
        ]
      }
    ];
    expect(
      shouldInjectDynamicLoopAudit([], [tc('finish')], false, messages)
    ).toBe(true);
    expect(resolveDynamicLoopAuditPrompt(messages)).toBe(ENHANCED_DYNAMIC_LOOP_AUDIT_PROMPT);
    expect(resolveDynamicLoopAuditPrompt([])).toBe(DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT);
  });

  it('ignores prior-run edits when runHistoryStartIndex scopes the audit', () => {
    const priorRunEdits: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: '1',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"a.ts"}' }
          }
        ]
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: '2',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"b.ts"}' }
          }
        ]
      }
    ];
    const messages: ChatMessage[] = [
      { role: 'system', content: 'harness' },
      { role: 'user', content: 'workspace' },
      ...priorRunEdits,
      { role: 'user', content: 'runtime' },
      { role: 'user', content: '<turn>follow up</turn>' }
    ];
    const runHistoryStartIndex = 2 + priorRunEdits.length;

    expect(runHasUnverifiedSubstantiveEdits(messages, runHistoryStartIndex)).toBe(false);
    expect(
      shouldInjectDynamicLoopAudit([], [tc('finish')], false, messages, runHistoryStartIndex)
    ).toBe(false);
    expect(resolveDynamicLoopAuditPrompt(messages, runHistoryStartIndex)).toBe(
      DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT
    );
  });
});
