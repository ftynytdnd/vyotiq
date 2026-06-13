import { describe, expect, it } from 'vitest';
import {
  classifyContextLevel,
  computeEffectiveWindow,
  reconcileContextBreakdown,
  scaleContextBreakdown,
  sumContextBreakdown,
  summarizeContextUsage
} from '@shared/context/contextLevel';

describe('contextLevel', () => {
  it('computeEffectiveWindow applies the usable fraction', () => {
    expect(computeEffectiveWindow(200_000, 0.9)).toBe(180_000);
    expect(computeEffectiveWindow(128_000, 1)).toBe(128_000);
    expect(computeEffectiveWindow(0, 0.9)).toBe(0);
    expect(computeEffectiveWindow(-5, 0.9)).toBe(0);
  });

  it('computeEffectiveWindow caps at the adaptive absolute ceiling', () => {
    // 1M window × 0.9 = 900k, capped to the 200k rot ceiling.
    expect(computeEffectiveWindow(1_000_000, 0.9, 200_000)).toBe(200_000);
    // Small window stays below the ceiling → unaffected.
    expect(computeEffectiveWindow(128_000, 0.9, 200_000)).toBe(115_200);
    // 0 ceiling disables the cap (pure fractional behavior).
    expect(computeEffectiveWindow(1_000_000, 0.9, 0)).toBe(900_000);
  });

  it('summarizeContextUsage honors the absolute ceiling and breakdown passthrough', () => {
    const breakdown = {
      system: 500,
      fewShot: 100,
      workspace: 200,
      history: 147_000,
      runtime: 100,
      turn: 100,
      tools: 1_000
    };
    const s = summarizeContextUsage({
      usedTokens: 150_000,
      advertisedWindow: 1_000_000,
      effectiveWindowFraction: 0.9,
      thresholds: { warnFraction: 0.7, triggerFraction: 0.75 },
      exact: true,
      absoluteCeilingTokens: 200_000,
      breakdown
    });
    expect(s.effectiveWindow).toBe(200_000);
    expect(s.fractionUsed).toBeCloseTo(0.75, 5);
    expect(s.level).toBe('trigger');
    expect(s.breakdown).toEqual(breakdown);
  });

  it('classifyContextLevel honors warn / trigger / critical bands', () => {
    const t = { warnFraction: 0.7, triggerFraction: 0.75 };
    expect(classifyContextLevel(0.5, t)).toBe('ok');
    expect(classifyContextLevel(0.72, t)).toBe('warn');
    expect(classifyContextLevel(0.8, t)).toBe('trigger');
    expect(classifyContextLevel(0.95, t)).toBe('critical');
  });

  it('summarizeContextUsage derives window, fraction, and level', () => {
    const s = summarizeContextUsage({
      usedTokens: 90_000,
      advertisedWindow: 128_000,
      effectiveWindowFraction: 0.9,
      thresholds: { warnFraction: 0.7, triggerFraction: 0.75 },
      exact: true
    });
    expect(s.effectiveWindow).toBe(115_200);
    expect(s.fractionUsed).toBeCloseTo(90_000 / 115_200, 5);
    expect(s.level).toBe('trigger');
    expect(s.exact).toBe(true);
  });

  it('summarizeContextUsage is ok when the window is unknown', () => {
    const s = summarizeContextUsage({
      usedTokens: 5_000,
      advertisedWindow: 0,
      effectiveWindowFraction: 0.9,
      thresholds: { warnFraction: 0.7, triggerFraction: 0.75 },
      exact: false
    });
    expect(s.effectiveWindow).toBe(0);
    expect(s.level).toBe('ok');
  });

  it('scaleContextBreakdown reconciles layer sum to the target total', () => {
    const base = {
      system: 333,
      fewShot: 333,
      workspace: 334,
      history: 0,
      runtime: 0,
      turn: 0,
      tools: 0
    };
    const scaled = scaleContextBreakdown(base, 1000, 333);
    expect(sumContextBreakdown(scaled)).toBe(333);
  });

  it('reconcileContextBreakdown absorbs rounding drift into the largest layer', () => {
    const drifted = {
      system: 10,
      fewShot: 5,
      workspace: 0,
      history: 100,
      runtime: 0,
      turn: 0,
      tools: 2
    };
    expect(sumContextBreakdown(drifted)).toBe(117);
    const fixed = reconcileContextBreakdown(drifted, 120);
    expect(sumContextBreakdown(fixed)).toBe(120);
    expect(fixed.history).toBe(103);
  });
});
