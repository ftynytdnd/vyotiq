import { describe, expect, it } from 'vitest';
import { toolErrorBody, toolErrorHint } from '@renderer/components/timeline/tools/shared/toolErrorDisplay';
import type { ToolResult } from '@shared/types/tool';

function failResult(partial: Partial<ToolResult>): ToolResult {
  return {
    ok: false,
    error: 'boom',
    output: '',
    data: undefined,
    ...partial
  } as ToolResult;
}

describe('toolErrorDisplay', () => {
  it('prefers first output line for collapsed hint', () => {
    const result = failResult({ output: 'line one\nline two', error: 'fallback' });
    expect(toolErrorHint(result)).toBe('line one');
    expect(toolErrorBody(result)).toBe('line one\nline two');
  });

  it('falls back to error when output is empty', () => {
    const result = failResult({ output: '', error: 'only error' });
    expect(toolErrorHint(result)).toBe('only error');
    expect(toolErrorBody(result)).toBe('only error');
  });
});
