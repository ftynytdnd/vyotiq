/**
 * Shimmer class composition helpers + per-instance phase offset.
 *
 * `shimmerText` / `shimmerPill` toggle the `vyotiq-shimmer-text` /
 * `vyotiq-shimmer-pill` utilities declared in `index.css` based on a
 * boolean flag. Each helper preserves any extra classes passed through
 * the `extra` parameter — important so existing color / italic / size
 * classes (e.g. `text-text-muted`, `italic`, `text-[12px]`) compose
 * correctly and test assertions that inspect those classes keep
 * working byte-identically.
 *
 * `shimmerStyle` returns an inline `style` object that sets the
 * `--shimmer-offset` CSS variable to a deterministic negative
 * `animation-delay` derived from a stable seed (row id, sub-agent id,
 * tool rowKey, …). Two shimmers with different seeds will be at
 * different points in their cycle on first paint, so concurrent
 * streaming surfaces desync naturally instead of marching in lockstep.
 *
 * When `active` is false, the shimmer utility is omitted and only
 * `extra` is returned — callers therefore safely unconditionally call
 * these helpers without branching on the running state themselves.
 */

import type { CSSProperties } from 'react';
import { cn } from './cn.js';

/** Gradient-sweep text. Composes with any existing color classes. */
export function shimmerText(active: boolean, extra?: string): string {
  return cn(active && 'vyotiq-shimmer-text', extra);
}

/** Small-pill shimmer variant (tuned for 10px labels in status pills). */
export function shimmerPill(active: boolean, extra?: string): string {
  return cn(active && 'vyotiq-shimmer-pill', extra);
}

/**
 * Match the longest cycle length declared in `index.css` (text variant
 * = 2.8s). Pills run a shorter 2.0s cycle but a delay anywhere in
 * `[-2.8s, 0s]` is still valid for them — animation-delay simply
 * "wraps" within the pill's own cycle.
 */
const SHIMMER_CYCLE_MS = 2800;

/**
 * Deterministic 32-bit FNV-1a. Cheap, dependency-free, and stable
 * across renders so the same seed always produces the same offset.
 */
function fnv1a(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Inline-style object that pins `--shimmer-offset` to a negative
 * `animation-delay` derived from `seed`. Returns `undefined` for an
 * empty / nullish seed so the element falls back to the default
 * (`0s`) — useful for surfaces like `StatusRow` where there is only
 * ever a single instance on screen.
 */
export function shimmerStyle(seed: string | null | undefined): CSSProperties | undefined {
  if (!seed) return undefined;
  // 0..0.999 — quantised to 1ms increments below to keep style
  // strings stable across re-renders (React diffing sees the same
  // string and skips the style mutation).
  const norm = (fnv1a(seed) % 1000) / 1000;
  const offsetMs = Math.round(norm * SHIMMER_CYCLE_MS);
  // Negative delay starts the animation already in progress, so
  // there's no first-frame flash of the 0% keyframe.
  return { '--shimmer-offset': `-${offsetMs}ms` } as CSSProperties;
}
