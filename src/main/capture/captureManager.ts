/**
 * Screen/window capture and workspace persistence for vision pipeline.
 */

import { desktopCapturer, nativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CAPTURE_DIR } from '@shared/constants.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import { getMainWindow } from '../window/getMainWindow.js';
import { browserCapturePage } from '../window/browserManager.js';
import { logger } from '../logging/logger.js';

const log = logger.child('capture');
void log;

export interface CaptureSourceInfo {
  id: string;
  name: string;
  thumbnailDataUrl?: string;
}

export interface CaptureResult {
  relPath: string;
  width: number;
  height: number;
  bytes: number;
}

export async function listCaptureSources(): Promise<CaptureSourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 }
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.isEmpty() ? undefined : s.thumbnail.toDataURL()
  }));
}

async function writePngToWorkspace(
  workspacePath: string,
  png: Buffer,
  prefix: string
): Promise<CaptureResult> {
  const dirRel = CAPTURE_DIR.replace(/\\/g, '/');
  const filename = `${prefix}-${Date.now()}.png`;
  const relPath = `${dirRel}/${filename}`;
  const absPath = join(workspacePath, dirRel);
  await mkdir(absPath, { recursive: true });
  const fullPath = join(absPath, filename);
  await writeFile(fullPath, png);
  await realpathInsideWorkspace(workspacePath, relPath);
  const image = nativeImage.createFromBuffer(png);
  const size = image.getSize();
  return {
    relPath,
    width: size.width,
    height: size.height,
    bytes: png.length
  };
}

export async function captureScreenToWorkspace(
  workspacePath: string,
  sourceId: string
): Promise<CaptureResult> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 1, height: 1 }
  });
  const source = sources.find((s) => s.id === sourceId);
  if (!source) throw new Error('Capture source not found');
  const thumb = source.thumbnail;
  if (thumb.isEmpty()) throw new Error('Capture source returned empty image');
  const png = thumb.toPNG();
  return writePngToWorkspace(workspacePath, png, 'screen');
}

export async function captureBrowserToWorkspace(workspacePath: string): Promise<CaptureResult> {
  const { png, width, height } = await browserCapturePage();
  const result = await writePngToWorkspace(workspacePath, png, 'browser');
  return { ...result, width, height };
}

export async function captureMainWindowToWorkspace(workspacePath: string): Promise<CaptureResult> {
  const win = getMainWindow();
  if (!win) throw new Error('No main window to capture');
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  return writePngToWorkspace(workspacePath, png, 'window');
}

export async function captureByTarget(
  workspacePath: string,
  target: 'browser' | 'screen' | 'window',
  sourceId?: string
): Promise<CaptureResult> {
  switch (target) {
    case 'browser':
      return captureBrowserToWorkspace(workspacePath);
    case 'window':
      return captureMainWindowToWorkspace(workspacePath);
    case 'screen':
      if (!sourceId) throw new Error('sourceId is required for screen capture');
      return captureScreenToWorkspace(workspacePath, sourceId);
    default: {
      const _exhaustive: never = target;
      void _exhaustive;
      throw new Error('Unknown capture target');
    }
  }
}
