import { describe, expect, it } from 'vitest';
import {
  isRerunnableToolCall,
  isRerunnableToolInput,
  isRerunnableToolName
} from '@shared/tools/toolRerun';
import type { ToolCall } from '@shared/types/tool';

function call(name: ToolCall['name'], args: Record<string, unknown>): ToolCall {
  return { id: 'test-call', name, args };
}

describe('tool rerun eligibility', () => {
  it('allows read-only tools by name', () => {
    expect(isRerunnableToolName('read')).toBe(true);
    expect(isRerunnableToolName('ls')).toBe(true);
    expect(isRerunnableToolName('search')).toBe(true);
    expect(isRerunnableToolName('bash')).toBe(false);
    expect(isRerunnableToolName('memory')).toBe(true);
  });

  it('rejects mutating or unsupported tools by name', () => {
    expect(isRerunnableToolName('edit')).toBe(false);
    expect(isRerunnableToolName('delete')).toBe(false);
    expect(isRerunnableToolName('report')).toBe(false);
    expect(isRerunnableToolName('unknown')).toBe(false);
  });

  it('allows memory list/read actions only', () => {
    expect(isRerunnableToolCall(call('memory', { action: 'list', scope: 'workspace' }))).toBe(true);
    expect(
      isRerunnableToolCall(call('memory', { action: 'read', scope: 'workspace', key: 'notes' }))
    ).toBe(true);
    expect(isRerunnableToolCall(call('memory', { action: 'write', scope: 'workspace', key: 'x' }))).toBe(
      false
    );
    expect(
      isRerunnableToolCall(call('memory', { action: 'append', scope: 'global', content: 'rule' }))
    ).toBe(false);
  });

  it('mirrors IPC input validation for memory writes', () => {
    expect(
      isRerunnableToolInput('memory', { action: 'read', scope: 'workspace', key: 'notes' })
    ).toBe(true);
    expect(
      isRerunnableToolInput('memory', { action: 'append', scope: 'global', content: 'rule' })
    ).toBe(false);
    expect(isRerunnableToolInput('read', { path: 'src/main.ts' })).toBe(true);
    expect(isRerunnableToolInput('edit', { path: 'src/main.ts' })).toBe(false);
  });
});
