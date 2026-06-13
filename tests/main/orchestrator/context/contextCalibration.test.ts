import { describe, expect, it } from 'vitest';
import {
  calibrationSelectionKey,
  clampCalibrationRatio
} from '@main/orchestrator/context/contextCalibration';

describe('contextCalibration', () => {
  it('calibrationSelectionKey is stable per provider+model', () => {
    expect(calibrationSelectionKey('ollama', 'gemma4:31b')).toBe('ollama\0gemma4:31b');
  });

  it('clampCalibrationRatio enforces the shared band', () => {
    expect(clampCalibrationRatio(0.2)).toBe(0.5);
    expect(clampCalibrationRatio(3)).toBe(2);
    expect(clampCalibrationRatio(1.15)).toBeCloseTo(1.15, 5);
    expect(clampCalibrationRatio(Number.NaN)).toBe(1);
  });
});
