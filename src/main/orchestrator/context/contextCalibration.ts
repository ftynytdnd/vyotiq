/**
 * Per-conversation calibration ratio cache (provider billed ÷ local estimate).
 *
 * Updated after each orchestrator turn when real `promptTokens` land.
 * Persisted on `ConversationMeta.contextCalibrationByModel` so idle
 * `context:evaluate` and manual compact/reset use the same anchor as live runs.
 */

import {
  CONTEXT_CALIBRATION_MAX,
  CONTEXT_CALIBRATION_MIN
} from '@shared/constants.js';
import type { ConversationMeta } from '@shared/types/chat.js';
import {
  getConversationMeta,
  setContextCalibrationOnMeta
} from '../../conversations/conversationStore.js';

const MEMORY_MAX = 64;
const memory = new Map<string, number>();

export function calibrationSelectionKey(providerId: string, modelId: string): string {
  return `${providerId}\0${modelId}`;
}

function memoryKey(
  conversationId: string,
  providerId: string,
  modelId: string
): string {
  return `${conversationId}\0${providerId}\0${modelId}`;
}

export function clampCalibrationRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(CONTEXT_CALIBRATION_MAX, Math.max(CONTEXT_CALIBRATION_MIN, ratio));
}

function readFromMeta(
  meta: ConversationMeta,
  providerId: string,
  modelId: string
): number | undefined {
  const map = meta.contextCalibrationByModel;
  if (!map) return undefined;
  const raw = map[calibrationSelectionKey(providerId, modelId)];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return clampCalibrationRatio(raw);
}

function touchMemory(key: string, ratio: number): void {
  memory.delete(key);
  memory.set(key, ratio);
  if (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

/** Persist and cache the calibration ratio for a conversation + model. */
export async function rememberContextCalibration(
  conversationId: string,
  providerId: string,
  modelId: string,
  ratio: number
): Promise<void> {
  const clamped = clampCalibrationRatio(ratio);
  touchMemory(memoryKey(conversationId, providerId, modelId), clamped);
  await setContextCalibrationOnMeta(
    conversationId,
    calibrationSelectionKey(providerId, modelId),
    clamped
  );
}

/** Load a cached calibration ratio for idle evaluate / manual reduction. */
export async function loadContextCalibration(
  conversationId: string | undefined,
  providerId: string,
  modelId: string
): Promise<number | undefined> {
  if (!conversationId) return undefined;

  const mem = memory.get(memoryKey(conversationId, providerId, modelId));
  if (typeof mem === 'number') return mem;

  const meta = await getConversationMeta(conversationId);
  if (!meta) return undefined;
  const fromMeta = readFromMeta(meta, providerId, modelId);
  if (fromMeta !== undefined) {
    touchMemory(memoryKey(conversationId, providerId, modelId), fromMeta);
  }
  return fromMeta;
}
