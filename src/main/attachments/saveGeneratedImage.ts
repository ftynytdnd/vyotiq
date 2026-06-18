/**
 * Persist model-generated images to the workspace.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GENERATED_IMAGE_DIR } from '@shared/constants.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';

export interface SavedGeneratedImage {
  storedPath: string;
  mime: string;
  bytes: number;
}

export async function saveGeneratedImage(
  workspacePath: string,
  runId: string,
  index: number,
  mime: string,
  base64: string
): Promise<SavedGeneratedImage> {
  const ext =
    mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg';
  const dirRel = GENERATED_IMAGE_DIR.replace(/\\/g, '/');
  const filename = `${runId}-${index}.${ext}`;
  const relPath = `${dirRel}/${filename}`;
  const dirAbs = join(workspacePath, dirRel);
  await mkdir(dirAbs, { recursive: true });
  const buffer = Buffer.from(base64, 'base64');
  const fullPath = join(dirAbs, filename);
  await writeFile(fullPath, buffer);
  await realpathInsideWorkspace(workspacePath, relPath);
  return { storedPath: relPath, mime, bytes: buffer.length };
}
