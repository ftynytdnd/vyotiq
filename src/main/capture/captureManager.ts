/**
 * Screen/window capture and workspace persistence for vision pipeline.
 */

import { desktopCapturer, nativeImage, screen } from 'electron';
import type { NativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_NAME, CAPTURE_DIR } from '@shared/constants.js';
import {
  CAPTURE_PICKER_PREVIEW_SIZE,
  CAPTURE_SOURCE_LIST_CACHE_MS
} from '@shared/capture/capturePickerConstants.js';
import {
  dedupeVyotiqWindowSources,
  formatCaptureSourceDisplayName
} from '@shared/capture/formatCaptureSourceName.js';
import { sortCaptureSources } from '@shared/capture/sortCaptureSources.js';
import { resolveCaptureSettings } from '@shared/settings/captureSettings.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import { getMainWindow } from '../window/getMainWindow.js';
import { browserCapturePage } from '../window/browserManager.js';
import { getSettings } from '../settings/settingsStore.js';
import { requestCaptureFramebuffer } from './captureFramebufferBridge.js';
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

export interface ListCaptureSourcesOptions {
  /** When false (default), skips thumbnail capture for a fast source list. */
  thumbnails?: boolean;
}

export interface IngestCaptureFrameOptions {
  workspacePath: string;
  png: Buffer;
  width: number;
  height: number;
  prefix?: string;
}

interface CaptureListCache {
  sources: CaptureSourceInfo[];
  fetchedAt: number;
}

let fastListCache: CaptureListCache | null = null;

function appWindowSourceId(): string | null {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return null;
  try {
    return win.getMediaSourceId();
  } catch {
    return null;
  }
}

/** Largest display dimension — desktopCapturer thumbnails scale to this size. */
export function maxCaptureThumbnailSize(): { width: number; height: number } {
  const displays = screen.getAllDisplays();
  let width = 1920;
  let height = 1080;
  for (const display of displays) {
    width = Math.max(width, display.size.width);
    height = Math.max(height, display.size.height);
  }
  const cap = 3840;
  return {
    width: Math.min(width, cap),
    height: Math.min(height, cap)
  };
}

function previewDataUrl(image: NativeImage): string | undefined {
  if (image.isEmpty()) return undefined;
  const jpeg = image.toJPEG(72);
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

function mapDesktopSources(
  sources: Electron.DesktopCapturerSource[],
  includeThumbnails: boolean,
  redactWindowTitles: boolean
): CaptureSourceInfo[] {
  return sources.map((s) => ({
    id: s.id,
    name: formatCaptureSourceDisplayName(s.name, s.id, redactWindowTitles),
    thumbnailDataUrl:
      includeThumbnails && !s.thumbnail.isEmpty() ? previewDataUrl(s.thumbnail) : undefined
  }));
}

function ensureAppWindowSource(sources: CaptureSourceInfo[]): CaptureSourceInfo[] {
  const sourceId = appWindowSourceId();
  if (!sourceId) return sources;
  if (sources.some((s) => s.id === sourceId)) return sources;
  return [
    ...sources,
    {
      id: sourceId,
      name: `${APP_NAME} (this window)`
    }
  ];
}

function finalizeSourceList(
  sources: Electron.DesktopCapturerSource[],
  includeThumbnails: boolean
): CaptureSourceInfo[] {
  const { redactWindowTitles } = resolveCaptureSettings(getSettings().ui);
  const appId = appWindowSourceId();
  const mapped = mapDesktopSources(sources, includeThumbnails, redactWindowTitles);
  const deduped = dedupeVyotiqWindowSources(mapped, appId);
  const withApp = ensureAppWindowSource(deduped);
  return sortCaptureSources(withApp, appId);
}

/** Invalidate cached picker source names (e.g. after display topology changes). */
export function invalidateCaptureSourceListCache(): void {
  fastListCache = null;
}

/**
 * List capture targets. Default (`thumbnails: false`) is optimized for picker open:
 * `thumbnailSize: 0` avoids per-window frame capture (Electron performance guidance).
 */
export async function listCaptureSources(
  options: ListCaptureSourcesOptions = {}
): Promise<CaptureSourceInfo[]> {
  const includeThumbnails = options.thumbnails ?? false;
  const now = Date.now();

  if (
    !includeThumbnails &&
    fastListCache &&
    now - fastListCache.fetchedAt < CAPTURE_SOURCE_LIST_CACHE_MS
  ) {
    return fastListCache.sources.map((s) => ({ ...s }));
  }

  const thumbnailSize = includeThumbnails
    ? CAPTURE_PICKER_PREVIEW_SIZE
    : { width: 0, height: 0 };

  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize,
    fetchWindowIcons: false
  });

  const mapped = finalizeSourceList(sources, includeThumbnails);

  if (!includeThumbnails) {
    fastListCache = {
      sources: mapped.map((s) => ({ ...s, thumbnailDataUrl: undefined })),
      fetchedAt: now
    };
    return mapped;
  }

  return mapped;
}

export async function writePngToWorkspace(
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

export async function ingestCaptureFrame(
  options: IngestCaptureFrameOptions
): Promise<CaptureResult> {
  const prefix = options.prefix?.trim() || 'screen';
  return writePngToWorkspace(options.workspacePath, options.png, prefix);
}

export async function captureScreenToWorkspace(
  workspacePath: string,
  sourceId: string,
  signal?: AbortSignal
): Promise<CaptureResult> {
  const frame = await requestCaptureFramebuffer(sourceId, signal);
  return ingestCaptureFrame({
    workspacePath,
    png: frame.png,
    width: frame.width,
    height: frame.height,
    prefix: 'screen'
  });
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
  sourceId?: string,
  signal?: AbortSignal
): Promise<CaptureResult> {
  switch (target) {
    case 'browser':
      return captureBrowserToWorkspace(workspacePath);
    case 'window':
      return captureMainWindowToWorkspace(workspacePath);
    case 'screen':
      if (!sourceId) throw new Error('sourceId is required for screen capture');
      return captureScreenToWorkspace(workspacePath, sourceId, signal);
    default: {
      const _exhaustive: never = target;
      void _exhaustive;
      throw new Error('Unknown capture target');
    }
  }
}
