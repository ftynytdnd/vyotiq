/**
 * Attachment ingest workspace containment — rejects prefix tricks like
 * `{root}/../outside` that `startsWith(workspaceRoot)` would mis-tag.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAttachmentInWorkspace } from '@main/attachments/resolveInWorkspace.js';

describe('resolveAttachmentInWorkspace', () => {
  let workspace: string;
  let insideFile: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-ws-'));
    await mkdir(join(workspace, 'src'), { recursive: true });
    insideFile = join(workspace, 'src', 'note.txt');
    await writeFile(insideFile, 'hello');
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('tags a file inside the workspace', async () => {
    const result = await resolveAttachmentInWorkspace(workspace, insideFile);
    expect(result).toEqual({
      inWorkspace: true,
      workspacePath: 'src/note.txt',
      absPath: insideFile
    });
  });

  it('resolves workspace-relative paths to an absolute read path', async () => {
    const result = await resolveAttachmentInWorkspace(workspace, 'src/note.txt');
    expect(result).toEqual({
      inWorkspace: true,
      workspacePath: 'src/note.txt',
      absPath: insideFile
    });
  });

  it('rejects a path that only shares a string prefix with the root', async () => {
    const escape = join(workspace, '..', 'outside.txt');
    const result = await resolveAttachmentInWorkspace(workspace, escape);
    expect(result).toEqual({ inWorkspace: false });
  });

  it('rejects ../ traversal from a relative path', async () => {
    const result = await resolveAttachmentInWorkspace(workspace, '../outside.txt');
    expect(result).toEqual({ inWorkspace: false });
  });
});
