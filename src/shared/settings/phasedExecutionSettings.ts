/**
 * Resolved defaults for phased execution (`settings.ui.phasedExecution`).
 */

import type { AppSettings } from '../types/ipc.js';
import type { PhasedExecutionMode } from '../types/phased.js';
import {
  DEFAULT_PHASE_CYCLE_CAP,
  MAX_TOTAL_ITERATIONS,
  PHASE_VERIFY_TIMEOUT_MAX_S,
  PHASE_VERIFY_TIMEOUT_MIN_S,
  PHASE_VERIFY_TIMEOUT_MS
} from '../constants.js';

export interface PhasedExecutionSettings {
  /** Tri-state: auto-classify, always on, or never. */
  mode: PhasedExecutionMode;
  /** Per-subtask phase-cycle convergence guard (soft cap). */
  phaseCycleCap: number;
  /** Soft global-iteration cap that surfaces the escape hatch. */
  maxIterations: number;
  /** Host acceptance-command timeout during VERIFY (ms). */
  verifyTimeoutMs: number;
}

export const DEFAULT_PHASED_EXECUTION_SETTINGS: PhasedExecutionSettings = {
  mode: 'auto',
  phaseCycleCap: DEFAULT_PHASE_CYCLE_CAP,
  maxIterations: MAX_TOTAL_ITERATIONS,
  verifyTimeoutMs: PHASE_VERIFY_TIMEOUT_MS
} as const;

export type ResolvedPhasedExecutionSettings = PhasedExecutionSettings;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function resolveMode(raw: unknown): PhasedExecutionMode {
  if (raw === 'always' || raw === 'never' || raw === 'auto') return raw;
  return DEFAULT_PHASED_EXECUTION_SETTINGS.mode;
}

export function resolvePhasedExecutionSettings(
  ui?: AppSettings['ui']
): ResolvedPhasedExecutionSettings {
  const p = ui?.phasedExecution;
  const verifyTimeoutS = clampInt(
    typeof p?.verifyTimeoutSeconds === 'number'
      ? p.verifyTimeoutSeconds
      : PHASE_VERIFY_TIMEOUT_MS / 1000,
    PHASE_VERIFY_TIMEOUT_MS / 1000,
    PHASE_VERIFY_TIMEOUT_MIN_S,
    PHASE_VERIFY_TIMEOUT_MAX_S
  );
  return {
    mode: resolveMode(p?.mode),
    phaseCycleCap: clampInt(p?.phaseCycleCap, DEFAULT_PHASE_CYCLE_CAP, 2, 64),
    maxIterations: clampInt(p?.maxIterations, MAX_TOTAL_ITERATIONS, 2, MAX_TOTAL_ITERATIONS),
    verifyTimeoutMs: verifyTimeoutS * 1000
  };
}
