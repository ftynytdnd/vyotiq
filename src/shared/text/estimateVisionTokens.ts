/**
 * Estimate vision image token cost from encoded dimensions (2026 heuristic).
 *
 * OpenAI-style tile model: 512px tiles, ~170 tokens per tile (low detail
 * baseline). Used for composer pre-flight when exact provider counts are
 * unavailable.
 */

import type { ChatContentPart } from '../types/chat.js';

const TILE_SIZE = 512;
const TOKENS_PER_TILE = 170;
const MIN_IMAGE_TOKENS = 85;

function decodedDataUrlBytes(url: string): { mime: string; bytes: number } | null {
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const header = url.slice(5, comma);
  if (!header.endsWith(';base64')) return null;
  const mime = header.slice(0, -';base64'.length);
  const base64 = url.slice(comma + 1);
  if (!mime || base64.length === 0) return null;
  return { mime, bytes: Math.floor((base64.length * 3) / 4) };
}

/** Best-effort vision token estimate from prepared content parts (no decode). */
export function estimateVisionTokensFromContent(parts: ChatContentPart[]): number {
  let total = 0;
  for (const part of parts) {
    switch (part.type) {
      case 'text':
        break;
      case 'image_url': {
        const parsed = decodedDataUrlBytes(part.image_url.url);
        if (!parsed) {
          total += MIN_IMAGE_TOKENS;
          break;
        }
        const edge = Math.min(1568, Math.max(64, Math.ceil(Math.sqrt(parsed.bytes * 8))));
        total += estimateImageTokensFromDimensions(edge, edge);
        break;
      }
      case 'file': {
        const parsed = decodedDataUrlBytes(part.file.file_data);
        total += estimatePdfTokens(parsed?.bytes ?? 0);
        break;
      }
      case 'video_url': {
        const parsed = decodedDataUrlBytes(part.video_url.url);
        total += estimateVideoTokens(parsed?.bytes ?? 0);
        break;
      }
      case 'input_audio':
        break;
      default: {
        const _exhaustive: never = part;
        void _exhaustive;
      }
    }
  }
  return total;
}

export function estimateImageTokensFromDimensions(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return MIN_IMAGE_TOKENS;
  }
  const tilesW = Math.ceil(width / TILE_SIZE);
  const tilesH = Math.ceil(height / TILE_SIZE);
  return Math.max(MIN_IMAGE_TOKENS, tilesW * tilesH * TOKENS_PER_TILE);
}

/** Rough PDF page-equivalent when dimensions unknown. */
export function estimatePdfTokens(byteLength: number): number {
  const pages = Math.max(1, Math.ceil(byteLength / (200 * 1024)));
  return pages * 2_000;
}

/** Rough video frame-equivalent heuristic. */
export function estimateVideoTokens(byteLength: number): number {
  const mb = byteLength / (1024 * 1024);
  return Math.max(1_000, Math.round(mb * 800));
}
