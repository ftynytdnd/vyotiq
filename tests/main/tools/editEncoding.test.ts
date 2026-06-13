/**
 * BOM + CRLF preservation for `edit.tool.ts`.
 */

import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  composeOnDiskText,
  decodeFileForEdit
} from '@main/tools/editFileEncoding';

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

import { editTool } from '@main/tools/edit.tool';
import type { ToolContext } from '@main/tools/types';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'vyotiq-edit-encoding-'));
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
    emit: () => {
      /* noop */
    }
  };
}

describe('editFileEncoding helpers', () => {
  it('strips UTF-8 BOM for matching and re-applies on write', () => {
    const raw = '\uFEFFline\r\n';
    const decoded = decodeFileForEdit(raw);
    expect(decoded.body).toBe('line\r\n');
    expect(decoded.encoding.utf8Bom).toBe(true);
    expect(decoded.encoding.eol).toBe('crlf');
    expect(composeOnDiskText('line\r\n', decoded.encoding)).toBe('\uFEFFline\r\n');
  });
});

describe('edit tool — CRLF + BOM round-trip', () => {
  it('preserves CRLF and UTF-8 BOM after a surgical replace', async () => {
    const rel = 'bom-crlf.txt';
    const abs = join(workspace, rel);
    const originalRaw = '\uFEFFalpha\r\nbeta\r\n';
    await fs.writeFile(abs, originalRaw, 'utf8');

    const result = await editTool.run(
      {
        path: rel,
        oldString: 'beta',
        newString: 'BETA'
      },
      makeCtx()
    );

    expect(result.ok).toBe(true);
    const onDisk = await fs.readFile(abs, 'utf8');
    expect(onDisk).toBe('\uFEFFalpha\r\nBETA\r\n');

    const decoded = decodeFileForEdit(onDisk);
    expect(decoded.encoding.utf8Bom).toBe(true);
    expect(decoded.encoding.eol).toBe('crlf');
    expect(composeOnDiskText('alpha\nBETA\n', decoded.encoding)).toBe(onDisk);
  });
});
