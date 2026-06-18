/**
 * Read, preprocess, and encode attachments into provider-ready content parts.
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { ChatContentPart, PromptAttachmentMeta } from '@shared/types/chat.js';
import type { ModelInputModality } from '@shared/types/provider.js';
import {
  VISION_IMAGE_MAX_BYTES,
  VISION_IMAGE_MAX_LONG_EDGE,
  VISION_PDF_MAX_BYTES,
  VISION_VIDEO_MAX_BYTES,
  VISION_AUDIO_MAX_BYTES
} from '@shared/constants.js';
import { mediaKindFromMeta } from '@shared/attachments/mediaKind.js';
import {
  estimateImageTokensFromDimensions,
  estimatePdfTokens,
  estimateVideoTokens
} from '@shared/text/estimateVisionTokens.js';
import {
  modelSupportsPdfNative,
  modelSupportsVideoNative,
  modelSupportsVision,
  modelSupportsAudioNative
} from '@shared/providers/visionCapabilities.js';
import { realpathInsideAttachmentsRoot } from './sandbox.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import type { PreparedMediaCache } from './preparedMediaCache.js';
import {
  getPreparedMediaFromDisk,
  hashPreprocessedBytes,
  putPreparedMediaOnDisk
} from './preparedMediaDiskCache.js';

export interface PreparedVisionMedia {
  part: ChatContentPart;
  width?: number;
  height?: number;
  encodedBytes: number;
  imageTokenEstimate?: number;
}

export interface PrepareVisionPartsInput {
  attachmentMeta: PromptAttachmentMeta[];
  workspacePath: string;
  inputModalities?: ModelInputModality[];
  cache?: PreparedMediaCache;
  cacheKeyPrefix?: string;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

async function resolveAttachmentAbsPath(
  meta: PromptAttachmentMeta,
  workspacePath: string
): Promise<string> {
  if (meta.workspacePath) {
    return realpathInsideWorkspace(workspacePath, meta.workspacePath);
  }
  if (!meta.storedPath) {
    throw new Error(`Attachment "${meta.name}" has no readable path`);
  }
  return realpathInsideAttachmentsRoot(meta.storedPath);
}

function toDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

async function prepareImagePart(
  absPath: string,
  meta: PromptAttachmentMeta,
  signal?: AbortSignal
): Promise<PreparedVisionMedia> {
  throwIfAborted(signal);
  const raw = await readFile(absPath, { signal });
  throwIfAborted(signal);

  let pipeline = sharp(raw, { failOn: 'none' });
  const lower = meta.name.toLowerCase();
  const isSvg = lower.endsWith('.svg') || meta.mimeType === 'image/svg+xml';

  if (isSvg) {
    pipeline = pipeline.png();
  }

  pipeline = pipeline.rotate().resize({
    width: VISION_IMAGE_MAX_LONG_EDGE,
    height: VISION_IMAGE_MAX_LONG_EDGE,
    fit: 'inside',
    withoutEnlargement: true
  });

  let outputMime = 'image/jpeg';
  let buffer: Buffer;
  if (lower.endsWith('.png') && !isSvg) {
    outputMime = 'image/png';
    buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (lower.endsWith('.webp') && !isSvg) {
    outputMime = 'image/webp';
    buffer = await pipeline.webp({ quality: 85 }).toBuffer();
  } else if (lower.endsWith('.gif') && !isSvg) {
    outputMime = 'image/gif';
    buffer = await pipeline.gif().toBuffer();
  } else {
    buffer = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    outputMime = 'image/jpeg';
  }

  if (buffer.length > VISION_IMAGE_MAX_BYTES) {
    buffer = await sharp(buffer)
      .resize({
        width: Math.floor(VISION_IMAGE_MAX_LONG_EDGE * 0.75),
        height: Math.floor(VISION_IMAGE_MAX_LONG_EDGE * 0.75),
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();
    outputMime = 'image/jpeg';
  }

  if (buffer.length > VISION_IMAGE_MAX_BYTES) {
    throw new Error(
      `Image "${meta.name}" exceeds ${VISION_IMAGE_MAX_BYTES / (1024 * 1024)} MB after compression`
    );
  }

  const metaSharp = await sharp(buffer).metadata();
  const width = metaSharp.width ?? undefined;
  const height = metaSharp.height ?? undefined;

  const hash = hashPreprocessedBytes(buffer);
  const diskHit = await getPreparedMediaFromDisk(hash);
  if (diskHit) return diskHit;

  const base64 = buffer.toString('base64');
  const url = toDataUrl(outputMime, base64);

  const prepared: PreparedVisionMedia = {
    part: { type: 'image_url', image_url: { url, detail: 'auto' } },
    width,
    height,
    encodedBytes: buffer.length,
    imageTokenEstimate:
      width && height ? estimateImageTokensFromDimensions(width, height) : undefined
  };

  await putPreparedMediaOnDisk(hash, buffer, prepared);
  return prepared;
}

async function preparePdfPart(
  absPath: string,
  meta: PromptAttachmentMeta,
  signal?: AbortSignal
): Promise<PreparedVisionMedia> {
  throwIfAborted(signal);
  const st = await stat(absPath);
  if (st.size > VISION_PDF_MAX_BYTES) {
    throw new Error(`PDF "${meta.name}" exceeds ${VISION_PDF_MAX_BYTES / (1024 * 1024)} MB vision cap`);
  }
  const bytes = await readFile(absPath, { signal });
  throwIfAborted(signal);
  const hash = hashPreprocessedBytes(bytes);
  const diskHit = await getPreparedMediaFromDisk(hash);
  if (diskHit) return diskHit;

  const base64 = bytes.toString('base64');
  const url = toDataUrl('application/pdf', base64);
  const prepared: PreparedVisionMedia = {
    part: {
      type: 'file',
      file: { filename: meta.name, file_data: url }
    },
    encodedBytes: bytes.length,
    imageTokenEstimate: estimatePdfTokens(bytes.length)
  };
  await putPreparedMediaOnDisk(hash, bytes, prepared);
  return prepared;
}

async function prepareVideoPart(
  absPath: string,
  meta: PromptAttachmentMeta,
  signal?: AbortSignal
): Promise<PreparedVisionMedia> {
  throwIfAborted(signal);
  const st = await stat(absPath);
  if (st.size > VISION_VIDEO_MAX_BYTES) {
    throw new Error(
      `Video "${meta.name}" exceeds ${VISION_VIDEO_MAX_BYTES / (1024 * 1024)} MB vision cap`
    );
  }
  const bytes = await readFile(absPath, { signal });
  throwIfAborted(signal);
  const hash = hashPreprocessedBytes(bytes);
  const diskHit = await getPreparedMediaFromDisk(hash);
  if (diskHit) return diskHit;

  const mime = meta.mimeType?.startsWith('video/') ? meta.mimeType : 'video/mp4';
  const base64 = bytes.toString('base64');
  const url = toDataUrl(mime, base64);
  const prepared: PreparedVisionMedia = {
    part: { type: 'video_url', video_url: { url } },
    encodedBytes: bytes.length,
    imageTokenEstimate: estimateVideoTokens(bytes.length)
  };
  await putPreparedMediaOnDisk(hash, bytes, prepared);
  return prepared;
}

function audioFormatFromName(name: string, mime?: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.wav')) return 'wav';
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.m4a')) return 'm4a';
  if (lower.endsWith('.ogg')) return 'ogg';
  if (lower.endsWith('.flac')) return 'flac';
  if (lower.endsWith('.aac')) return 'aac';
  if (lower.endsWith('.opus')) return 'opus';
  if (mime?.includes('mpeg')) return 'mp3';
  if (mime?.includes('wav')) return 'wav';
  return 'wav';
}

async function prepareAudioPart(
  absPath: string,
  meta: PromptAttachmentMeta,
  signal?: AbortSignal
): Promise<PreparedVisionMedia> {
  throwIfAborted(signal);
  const st = await stat(absPath);
  if (st.size > VISION_AUDIO_MAX_BYTES) {
    throw new Error(
      `Audio "${meta.name}" exceeds ${VISION_AUDIO_MAX_BYTES / (1024 * 1024)} MB cap`
    );
  }
  const bytes = await readFile(absPath, { signal });
  throwIfAborted(signal);
  const hash = hashPreprocessedBytes(bytes);
  const diskHit = await getPreparedMediaFromDisk(hash);
  if (diskHit) return diskHit;
  const format = audioFormatFromName(meta.name, meta.mimeType);
  const base64 = bytes.toString('base64');
  const prepared: PreparedVisionMedia = {
    part: { type: 'input_audio', input_audio: { data: base64, format } },
    encodedBytes: bytes.length
  };
  await putPreparedMediaOnDisk(hash, bytes, prepared);
  return prepared;
}

async function prepareOne(
  meta: PromptAttachmentMeta,
  input: PrepareVisionPartsInput
): Promise<PreparedVisionMedia | null> {
  const kind = meta.mediaKind ?? mediaKindFromMeta(meta);
  const modalities = input.inputModalities;

  if (kind === 'text') return null;
  if (kind === 'image' && !modelSupportsVision(modalities)) return null;
  if (kind === 'pdf' && !modelSupportsPdfNative(modalities)) return null;
  if (kind === 'video' && !modelSupportsVideoNative(modalities)) return null;
  if (kind === 'audio' && !modelSupportsAudioNative(modalities)) return null;

  const absPath = await resolveAttachmentAbsPath(meta, input.workspacePath);
  const cacheKey = `${input.cacheKeyPrefix ?? ''}:${absPath}:${kind}`;
  const cached = input.cache?.get(cacheKey);
  if (cached) return cached;

  let prepared: PreparedVisionMedia;
  if (kind === 'image') {
    prepared = await prepareImagePart(absPath, meta, input.signal);
  } else if (kind === 'pdf') {
    prepared = await preparePdfPart(absPath, meta, input.signal);
  } else if (kind === 'video') {
    prepared = await prepareVideoPart(absPath, meta, input.signal);
  } else if (kind === 'audio') {
    prepared = await prepareAudioPart(absPath, meta, input.signal);
  } else {
    return null;
  }

  input.cache?.set(cacheKey, prepared);
  return prepared;
}

/**
 * Produce native vision content parts for attachments the active model accepts.
 * Returns parts in attach order; images before PDFs before videos (wire best practice).
 */
export async function prepareVisionParts(
  input: PrepareVisionPartsInput
): Promise<{ parts: ChatContentPart[]; visionTokenEstimate: number; preparedWorkspacePaths: string[] }> {
  const images: ChatContentPart[] = [];
  const pdfs: ChatContentPart[] = [];
  const videos: ChatContentPart[] = [];
  const audios: ChatContentPart[] = [];
  const preparedWorkspacePaths: string[] = [];
  let visionTokenEstimate = 0;

  for (const meta of input.attachmentMeta) {
    try {
      const prepared = await prepareOne(meta, input);
      if (!prepared) continue;
      const workspacePath = meta.workspacePath ?? meta.storedPath;
      if (workspacePath) preparedWorkspacePaths.push(workspacePath);
      if (prepared.imageTokenEstimate) visionTokenEstimate += prepared.imageTokenEstimate;
      const kind = meta.mediaKind ?? mediaKindFromMeta(meta);
      if (kind === 'image') images.push(prepared.part);
      else if (kind === 'pdf') pdfs.push(prepared.part);
      else if (kind === 'video') videos.push(prepared.part);
      else if (kind === 'audio') audios.push(prepared.part);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.name === 'AbortError') throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to prepare "${meta.name}" for vision: ${msg}`);
    }
  }

  return {
    parts: [...images, ...pdfs, ...videos, ...audios],
    visionTokenEstimate,
    preparedWorkspacePaths
  };
}

/** Resolve absolute path for tests / diagnostics. */
export async function resolveAttachmentAbsPathForVision(
  meta: PromptAttachmentMeta,
  workspacePath: string
): Promise<string> {
  return resolveAttachmentAbsPath(meta, workspacePath);
}

export function workspaceAbsFromRelative(workspacePath: string, rel: string): string {
  return join(workspacePath, rel);
}
