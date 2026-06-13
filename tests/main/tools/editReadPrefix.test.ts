/**
 * `edit` read-prefix stripping and match behaviour.
 */

import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  READ_TOOL_LINE_PREFIX_RE,
  stripReadLinePrefixesIfUniform,
  normalizeEditNeedles
} from '@main/tools/editHelpers';
import { editTool } from '@main/tools/edit.tool';
import type { ToolContext } from '@main/tools/types';

vi.mock('@main/checkpoints/index', () => ({
  recordChange: vi.fn(async () => ({
    id: 'stub',
    runId: 'r',
    conversationId: 'c',
    workspaceId: 'ws',
    filePath: 'x',
    kind: 'modify' as const,
    ts: 0,
    additions: 0,
    deletions: 0,
    accepted: false,
    rejected: false,
    source: 'edit' as const
  }))
}));

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'vyotiq-edit-prefix-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function makeCtx(): ToolContext {
  return {
    workspacePath: workspace,
    workspaceId: 'ws-1',
    runId: 'run-1',
    conversationId: 'conv-1',
    strictApprovals: false,
    signal: new AbortController().signal,
    emit: () => undefined
  };
}

/** Same shape as `read.tool.ts` line numbering. */
function readStyleLine(n: number, text: string): string {
  return `${String(n).padStart(5, ' ')}\t${text}`;
}

describe('stripReadLinePrefixesIfUniform', () => {
  it('strips read-style prefixes when every non-empty line is prefixed', () => {
    const pasted = [readStyleLine(10, 'alpha'), readStyleLine(11, 'beta')].join('\n');
    expect(stripReadLinePrefixesIfUniform(pasted)).toBe('alpha\nbeta');
  });

  it('does not strip when only some lines are prefixed', () => {
    const mixed = `alpha\n${readStyleLine(2, 'beta')}`;
    expect(stripReadLinePrefixesIfUniform(mixed)).toBe(mixed);
  });

  it('does not strip normal code that happens to start with digits+tab on one line', () => {
    const code = 'const x = 1;\nreturn x;\n';
    expect(stripReadLinePrefixesIfUniform(code)).toBe(code);
  });

  it('matches read output regex used in docs', () => {
    expect(READ_TOOL_LINE_PREFIX_RE.test(readStyleLine(1, 'foo'))).toBe(true);
    expect(READ_TOOL_LINE_PREFIX_RE.test('const x = 1;')).toBe(false);
  });

  it('normalizeEditNeedles strips both sides uniformly', () => {
    const oldP = readStyleLine(1, 'old');
    const newP = readStyleLine(1, 'new');
    expect(normalizeEditNeedles(oldP, newP)).toEqual({ oldString: 'old', newString: 'new' });
  });
});

describe('edit tool — read prefix recovery', () => {
  it('applies edit when oldString uses read line prefixes', async () => {
    const body = 'function hello() {\n  return "hi";\n}\n';
    await fs.writeFile(join(workspace, 'sample.ts'), body, 'utf8');

    const oldString = [readStyleLine(1, 'function hello() {'), readStyleLine(2, '  return "hi";')].join(
      '\n'
    );
    const newString = [readStyleLine(1, 'function hello() {'), readStyleLine(2, '  return "hello";')].join(
      '\n'
    );

    const result = await editTool.run(
      { path: 'sample.ts', oldString, newString },
      makeCtx()
    );

    expect(result.ok).toBe(true);
    const onDisk = await fs.readFile(join(workspace, 'sample.ts'), 'utf8');
    expect(onDisk).toContain('return "hello";');
    expect(onDisk).not.toContain('return "hi";');
  });

  it('still fails ambiguous match after prefix strip', async () => {
    const body = 'shared();\nshared();\n';
    await fs.writeFile(join(workspace, 'dup.ts'), body, 'utf8');

    const oldString = readStyleLine(1, 'shared();');
    const result = await editTool.run(
      { path: 'dup.ts', oldString, newString: readStyleLine(1, 'other();') },
      makeCtx()
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('ambiguous');
    expect(result.output).toMatch(/matches 2 locations/i);
  });

  it('includes similar-line hints when oldString is not found', async () => {
    const body = '    const value = 42;\n';
    await fs.writeFile(join(workspace, 'hint.ts'), body, 'utf8');

    const result = await editTool.run(
      { path: 'hint.ts', oldString: 'const value = 99', newString: 'const value = 0' },
      makeCtx()
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('no match');
    expect(result.output).toMatch(/Closest existing lines/i);
    expect(result.output).toMatch(/const value = 42/);
  });
});
