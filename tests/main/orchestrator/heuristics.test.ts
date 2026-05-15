/**
 * Regression tests for the post-audit `isPlanningWithoutAction`.
 *
 * The heuristic was deliberately reduced from 240 lines of regex
 * bandages to two structural checks:
 *
 *   1. Reasoning-only empty turn → nudge.
 *   2. Unclosed `<delegate ...` tag in the raw text → nudge.
 *
 * Everything else (substantive answers, clarifying questions,
 * completion narrations, plan-announcements that the model decides to
 * emit anyway, body-level "first/finally/step" enumerations, etc.) is
 * a clean terminus. The consolidated harness handles language-level
 * guidance.
 */

import { describe, it, expect } from 'vitest';
import { isPlanningWithoutAction } from '@main/orchestrator/heuristics/isPlanningWithoutAction';

describe('isPlanningWithoutAction (post-audit minimal surface)', () => {
  describe('action overrides nudges', () => {
    it('returns false when a tool call ran', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: 'I will read the README next.',
          hadToolCall: true,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('returns false when a delegate fired', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: '',
          hadToolCall: false,
          hadDelegate: true
        })
      ).toBe(false);
    });
  });

  describe('reasoning-only nudge', () => {
    it('fires on empty + reasoning-only turn', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: '',
          hadToolCall: false,
          hadDelegate: false,
          hadReasoning: true
        })
      ).toBe(true);
    });

    it('does NOT fire on empty turn with no reasoning', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: '',
          hadToolCall: false,
          hadDelegate: false,
          hadReasoning: false
        })
      ).toBe(false);
    });
  });

  describe('unclosed-delegate nudge (rawText path)', () => {
    it('fires when raw text ends with an unclosed `<delegate` tag', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: 'Spawning A1 to read the config.',
          hadToolCall: false,
          hadDelegate: false,
          rawText: 'Spawning A1 to read the config.\n<delegate id="A1" task="Read src/config.ts'
        })
      ).toBe(true);
    });

    it('fires on a bare opening tag without attributes (truncated mid-stream)', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: '',
          hadToolCall: false,
          hadDelegate: false,
          rawText: 'I will delegate next.\n<delegate'
        })
      ).toBe(true);
    });

    it('does NOT fire when the directive closed normally — even if raw still contains the form', () => {
      // Both raw and clean reflect a fully-closed directive that the
      // parser would have already fired; the `hadDelegate` flag is the
      // source of truth and it short-circuits before we reach the
      // structural check anyway.
      expect(
        isPlanningWithoutAction({
          cleanText: '',
          hadToolCall: false,
          hadDelegate: true,
          rawText: '<delegate id="A1" task="x" />'
        })
      ).toBe(false);
    });

    it('does NOT fire on substantive answer with no delegate markup', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: 'I reviewed the bootstrap sequence and confirmed it matches the audit notes.',
          hadToolCall: false,
          hadDelegate: false,
          rawText: 'I reviewed the bootstrap sequence and confirmed it matches the audit notes.'
        })
      ).toBe(false);
    });
  });

  describe('subtraction — formerly false-positive cases now terminate cleanly', () => {
    /**
     * Cases that the OLD heuristic flagged for nudging. The new
     * heuristic must NOT nudge any of them — the harness handles them
     * via prose guidance instead.
     */

    it('does NOT nudge a planning paragraph without action', () => {
      expect(
        isPlanningWithoutAction({
          cleanText:
            "Here's my plan: first I'll list the workspace, then I will read the README, finally I will summarize.",
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('does NOT nudge a "let me delegate this" narration', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: 'Let me delegate this to a sub-agent.',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('does NOT nudge first-person future intent without action', () => {
      expect(
        isPlanningWithoutAction({
          cleanText:
            "I'll start by listing the workspace, reading the README, and then summarizing the findings.",
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('does NOT nudge a substantive answer ending in "task is complete"', () => {
      expect(
        isPlanningWithoutAction({
          cleanText:
            'Reviewed every provider, every tool registration, and every retry path. ' +
            'Found two minor issues; both are tracked in the audit log. ' +
            'The verification task is complete and no further action is needed.',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('does NOT nudge a clarifying question', () => {
      expect(
        isPlanningWithoutAction({
          cleanText:
            'I have produced a thorough audit. Which of these would you like me to tackle first?',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('does NOT nudge a body-level "first/finally" enumeration', () => {
      expect(
        isPlanningWithoutAction({
          cleanText:
            'The harness has three layers. First, the orchestrator decomposes the task. ' +
            'Second, sub-agents execute in isolated contexts. Finally, the verifier ' +
            'checks the result envelope.',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('does NOT nudge a one-liner', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: 'OK.',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });
  });
});
