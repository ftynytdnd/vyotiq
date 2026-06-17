import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASED_EXECUTION_SETTINGS,
  resolvePhasedExecutionSettings
} from '../../../src/shared/settings/phasedExecutionSettings.js';
import {
  MAX_TOTAL_ITERATIONS,
  PHASE_VERIFY_TIMEOUT_MAX_S,
  PHASE_VERIFY_TIMEOUT_MIN_S
} from '../../../src/shared/constants.js';

describe('resolvePhasedExecutionSettings', () => {
  it('returns documented defaults when unset', () => {
    const r = resolvePhasedExecutionSettings(undefined);
    expect(r).toEqual(DEFAULT_PHASED_EXECUTION_SETTINGS);
    expect(r.mode).toBe('auto');
    expect(r.maxIterations).toBe(MAX_TOTAL_ITERATIONS);
    expect(r.verifyTimeoutMs).toBe(120_000);
  });

  it('clamps phaseCycleCap to [2, 64]', () => {
    expect(resolvePhasedExecutionSettings({ phasedExecution: { phaseCycleCap: 1 } }).phaseCycleCap).toBe(2);
    expect(resolvePhasedExecutionSettings({ phasedExecution: { phaseCycleCap: 999 } }).phaseCycleCap).toBe(64);
    expect(resolvePhasedExecutionSettings({ phasedExecution: { phaseCycleCap: 12 } }).phaseCycleCap).toBe(12);
  });

  it('clamps maxIterations to [2, hard ceiling]', () => {
    expect(resolvePhasedExecutionSettings({ phasedExecution: { maxIterations: 0 } }).maxIterations).toBe(2);
    expect(
      resolvePhasedExecutionSettings({ phasedExecution: { maxIterations: 9999 } }).maxIterations
    ).toBe(MAX_TOTAL_ITERATIONS);
  });

  it('clamps and converts verifyTimeoutSeconds to ms', () => {
    expect(
      resolvePhasedExecutionSettings({ phasedExecution: { verifyTimeoutSeconds: 1 } }).verifyTimeoutMs
    ).toBe(PHASE_VERIFY_TIMEOUT_MIN_S * 1000);
    expect(
      resolvePhasedExecutionSettings({ phasedExecution: { verifyTimeoutSeconds: 99999 } }).verifyTimeoutMs
    ).toBe(PHASE_VERIFY_TIMEOUT_MAX_S * 1000);
    expect(
      resolvePhasedExecutionSettings({ phasedExecution: { verifyTimeoutSeconds: 45 } }).verifyTimeoutMs
    ).toBe(45_000);
  });

  it('falls back to default mode on bad input', () => {
    expect(
      resolvePhasedExecutionSettings({ phasedExecution: { mode: 'bogus' as never } }).mode
    ).toBe('auto');
  });
});
