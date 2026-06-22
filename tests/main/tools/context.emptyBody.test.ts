/**
 * Error-handling path for the `context` tool: when a pack body resolves
 * empty (e.g. a blank user override with a missing bundled body), `load`
 * must fail gracefully with `ok:false` rather than returning a header with
 * no content or crashing on a downstream `.trim()`.
 *
 * `getContextPackBody` is mocked to '' in isolation so the happy-path tests
 * in `context.test.ts` keep exercising the real pack bodies.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/harness/contextPacks', () => ({
  getContextPackBody: () => ''
}));

import { contextTool } from '@main/tools/context.tool';
import type { ToolContext } from '@main/tools/types';

function makeCtx(): ToolContext {
  return {
    workspacePath: '/tmp',
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
    signal: new AbortController().signal,
    emit: () => {}
  };
}

describe('context tool — empty pack body', () => {
  it('fails gracefully when a pack body resolves empty', async () => {
    const result = await contextTool.run(
      { action: 'load', pack: 'ast-grep-reference' },
      makeCtx()
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('empty pack body');
    expect(result.output).toContain('unavailable');
  });

  it('still lists the catalogue (list does not depend on pack bodies)', async () => {
    const result = await contextTool.run({ action: 'list' }, makeCtx());
    expect(result.ok).toBe(true);
  });
});
