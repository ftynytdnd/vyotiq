/**
 * Regression: workspace-relative capture paths must stat against the workspace,
 * not process.cwd() (dev main runs with CWD = vyotiq repo).
 */

import { describe, expect, it, afterEach } from 'vitest';
import { chdir, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CAPTURE_DIR } from '@shared/constants.js';
import { resolveAttachmentInWorkspace } from '@main/attachments/resolveInWorkspace.js';
import { ingestExternalFile } from '@main/attachments/ingest.js';

describe('ingestExternalFile with workspace-relative paths', () => {
  let workspace: string;
  let wrongCwd: string;
  let priorCwd: string;
  let relCapturePath: string;

  afterEach(async () => {
    process.chdir(priorCwd);
    await rm(workspace, { recursive: true, force: true });
    await rm(wrongCwd, { recursive: true, force: true });
  });

  it('reads capture files when cwd differs from the active workspace', async () => {
    priorCwd = process.cwd();
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-ws-'));
    wrongCwd = await mkdtemp(join(tmpdir(), 'vyotiq-cwd-'));

    const captureDir = join(workspace, CAPTURE_DIR);
    await mkdir(captureDir, { recursive: true });
    const captureFile = join(captureDir, 'screen-test.png');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(captureFile, png);

    relCapturePath = `${CAPTURE_DIR}/screen-test.png`;
    process.chdir(wrongCwd);

    const ws = await resolveAttachmentInWorkspace(workspace, relCapturePath);
    expect(ws.inWorkspace).toBe(true);
    if (!ws.inWorkspace) return;

    const meta = await ingestExternalFile({
      sourcePath: ws.absPath,
      workspaceId: 'ws-id',
      conversationId: 'conv-id',
      messageId: 'msg-id',
      workspacePath: ws.workspacePath
    });

    expect(meta.workspacePath).toBe(relCapturePath.replace(/\\/g, '/'));
    expect(meta.external).toBe(false);
    expect(meta.sizeBytes).toBe(png.length);
  });
});
