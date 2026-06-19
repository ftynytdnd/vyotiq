import type { CaptureSourceInfo } from '../types/capture.js';

/** Merge thumbnail previews into an existing source list without reordering rows. */
export function mergeCaptureSources(
  base: CaptureSourceInfo[],
  withThumbnails: CaptureSourceInfo[]
): CaptureSourceInfo[] {
  if (base.length === 0) return withThumbnails.map((s) => ({ ...s }));
  const thumbById = new Map(withThumbnails.map((s) => [s.id, s.thumbnailDataUrl]));
  return base.map((source) => {
    const thumbnailDataUrl = thumbById.get(source.id) ?? source.thumbnailDataUrl;
    if (thumbnailDataUrl === source.thumbnailDataUrl) return source;
    return { ...source, thumbnailDataUrl };
  });
}
