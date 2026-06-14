import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_CLEAR_TOOL_TRIGGER_CUSHION_TOKENS,
  ANTHROPIC_SERVER_COMPACTION_MIN_TRIGGER_TOKENS,
  ANTHROPIC_SERVER_COMPACTION_TRIGGER_OFFSET_TOKENS,
  applyHistoryCompactionPressure,
  classifyCompactionLevel,
  classifyContextLevel,
  reconcileContextBreakdown,
  resolveAnthropicClearToolTriggerInputTokens,
  resolveAnthropicServerCompactionTriggerTokens,
  resolveCompactionThresholds,
  resolveModelContextWindow,
  scaleContextBreakdown,
  sumContextBreakdown,
  summarizeContextUsage
} from '@shared/context/contextLevel';
import {
  CONTEXT_ABSOLUTE_COMPACTION_TRIGGER_TOKENS,
  CONTEXT_ABSOLUTE_COMPACTION_WARN_TOKENS,
  CONTEXT_HISTORY_COMPACTION_TRIGGER_TOKENS,
  CONTEXT_HISTORY_COMPACTION_WARN_TOKENS
} from '@shared/constants';

describe('contextLevel', () => {
  it('resolveModelContextWindow returns the full discovered window', () => {
    expect(resolveModelContextWindow(1_000_000)).toBe(1_000_000);
    expect(resolveModelContextWindow(128_000)).toBe(128_000);
    expect(resolveModelContextWindow(0)).toBe(0);
    expect(resolveModelContextWindow(-5)).toBe(0);
  });

  it('summarizeContextUsage uses the full model window for display % and breakdown', () => {
    const breakdown = {
      system: 500,
      fewShot: 100,
      workspace: 200,
      history: 747_000,
      runtime: 100,
      turn: 100,
      tools: 1_000
    };
    const s = summarizeContextUsage({
      usedTokens: 750_000,
      advertisedWindow: 1_000_000,
      thresholds: { warnFraction: 0.7, triggerFraction: 0.75 },
      exact: true,
      breakdown
    });
    expect(s.effectiveWindow).toBe(1_000_000);
    expect(s.advertisedWindow).toBe(1_000_000);
    expect(s.fractionUsed).toBeCloseTo(0.75, 5);
    expect(s.level).toBe('critical');
    expect(s.breakdown).toEqual(breakdown);
  });

  it('resolveCompactionThresholds caps large windows at absolute token bands', () => {
    const t = { warnFraction: 0.7, triggerFraction: 0.75 };
    expect(resolveCompactionThresholds(1_000_000, t)).toEqual({
      warnTokens: CONTEXT_ABSOLUTE_COMPACTION_WARN_TOKENS,
      triggerTokens: CONTEXT_ABSOLUTE_COMPACTION_TRIGGER_TOKENS
    });
    expect(resolveCompactionThresholds(128_000, t)).toEqual({
      warnTokens: Math.floor(128_000 * 0.7),
      triggerTokens: Math.floor(128_000 * 0.75)
    });
  });

  it('display % and compaction level diverge on 1M models near absolute trigger', () => {
    const s = summarizeContextUsage({
      usedTokens: 205_000,
      advertisedWindow: 1_000_000,
      thresholds: { warnFraction: 0.7, triggerFraction: 0.75 },
      exact: true
    });
    expect(s.fractionUsed).toBeCloseTo(0.205, 3);
    expect(s.level).toBe('trigger');
  });

  it('history-dominated prompts warn on 1M windows before total absolute warn', () => {
    const breakdown = {
      system: 9_000,
      fewShot: 300,
      workspace: 100,
      history: 119_000,
      runtime: 1_500,
      turn: 900,
      tools: 2_000
    };
    const s = summarizeContextUsage({
      usedTokens: 132_800,
      advertisedWindow: 1_000_000,
      thresholds: { warnFraction: 0.7, triggerFraction: 0.75 },
      exact: true,
      breakdown
    });
    expect(s.fractionUsed).toBeLessThan(0.2);
    expect(s.level).toBe('warn');
  });

  it('applyHistoryCompactionPressure escalates to trigger at history band', () => {
    expect(
      applyHistoryCompactionPressure('ok', {
        system: 0,
        fewShot: 0,
        workspace: 0,
        history: CONTEXT_HISTORY_COMPACTION_TRIGGER_TOKENS,
        runtime: 0,
        turn: 0,
        tools: 0
      })
    ).toBe('trigger');
    expect(
      applyHistoryCompactionPressure('ok', {
        system: 0,
        fewShot: 0,
        workspace: 0,
        history: CONTEXT_HISTORY_COMPACTION_WARN_TOKENS,
        runtime: 0,
        turn: 0,
        tools: 0
      })
    ).toBe('warn');
  });

  it('resolveAnthropicClearToolTriggerInputTokens sits above host compaction trigger', () => {
    const thresholds = { warnFraction: 0.7, triggerFraction: 0.75 };
    expect(
      resolveAnthropicClearToolTriggerInputTokens(1_000_000, thresholds)
    ).toBe(CONTEXT_ABSOLUTE_COMPACTION_TRIGGER_TOKENS + ANTHROPIC_CLEAR_TOOL_TRIGGER_CUSHION_TOKENS);
    expect(
      resolveAnthropicClearToolTriggerInputTokens(128_000, thresholds)
    ).toBe(Math.floor(128_000 * 0.75) + ANTHROPIC_CLEAR_TOOL_TRIGGER_CUSHION_TOKENS);
  });

  it('resolveAnthropicServerCompactionTriggerTokens respects API floor and host offset', () => {
    const thresholds = { warnFraction: 0.7, triggerFraction: 0.75 };
    expect(
      resolveAnthropicServerCompactionTriggerTokens(1_000_000, thresholds)
    ).toBe(CONTEXT_ABSOLUTE_COMPACTION_TRIGGER_TOKENS - ANTHROPIC_SERVER_COMPACTION_TRIGGER_OFFSET_TOKENS);
    expect(
      resolveAnthropicServerCompactionTriggerTokens(64_000, thresholds)
    ).toBe(ANTHROPIC_SERVER_COMPACTION_MIN_TRIGGER_TOKENS);
  });

  it('classifyCompactionLevel uses token bands', () => {
    expect(classifyCompactionLevel(150_000, 180_000, 200_000)).toBe('ok');
    expect(classifyCompactionLevel(185_000, 180_000, 200_000)).toBe('warn');
    expect(classifyCompactionLevel(200_000, 180_000, 200_000)).toBe('trigger');
    expect(classifyCompactionLevel(211_000, 180_000, 200_000)).toBe('critical');
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
      usedTokens: 96_000,
      advertisedWindow: 128_000,
      thresholds: { warnFraction: 0.7, triggerFraction: 0.75 },
      exact: true
    });
    expect(s.effectiveWindow).toBe(128_000);
    expect(s.fractionUsed).toBeCloseTo(96_000 / 128_000, 5);
    expect(s.level).toBe('trigger');
    expect(s.exact).toBe(true);
  });

  it('summarizeContextUsage is ok when the window is unknown', () => {
    const s = summarizeContextUsage({
      usedTokens: 5_000,
      advertisedWindow: 0,
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
