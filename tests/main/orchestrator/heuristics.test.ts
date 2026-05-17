/**
 * Regression tests for the post-audit `isPlanningWithoutAction`.
 *
 * The heuristic is intentionally tiny — a single structural check:
 *
 *   - Reasoning-only empty turn → `reasoning-only`.
 *
 * The earlier `unclosed-delegate` re-emit nudge was removed: a
 * truncated `<delegate ...` tag is silently ignored by
 * `parseDelegates`, masked by `stripDelegatesForDisplay`, and the
 * model can self-regulate against `<run_state>.iteration` and the
 * `finish_reason` it sees in subsequent turns. Phrase-matching
 * ("I'll delegate", "let me spawn", colon hand-offs, etc.) is also
 * NOT in the heuristic. The narration-loop pathology those regex
 * bandages tried to catch was a symptom of an Ollama-transport bug
 * (`reasoning_content` was being stripped on outgoing messages,
 * losing the model's plan across turns) — not a heuristic concern.
 * That root cause is fixed in `providers/ollamaChatStream.ts`.
 *
 * Everything else (substantive answers, clarifying questions,
 * completion narrations, plan-announcements that the model decides to
 * emit anyway, body-level "first/finally/step" enumerations, partial
 * `<delegate ...` truncations, etc.) is a clean terminus.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyPlanningWithoutAction,
  isPlanningWithoutAction
} from '@main/orchestrator/heuristics/isPlanningWithoutAction';

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

  describe('partial / unclosed `<delegate>` is a clean terminus', () => {
    /**
     * The host previously fired a re-emit nudge when the assistant
     * text ended with an unclosed `<delegate ...` tag. That surface
     * was removed: the parser already silently ignores partials, the
     * renderer-side strip keeps the partial XML out of the timeline,
     * and the `<run_state>` envelope already exposes the iteration /
     * finish_reason context the model needs to recover. Pin the new
     * contract here.
     */

    it('does NOT fire when output text contains a partial `<delegate` tag', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: 'Spawning A1 to read the config.',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('does NOT fire on an empty turn that came from a length-truncated directive', () => {
      // The strip pass collapsed the partial to empty, the
      // `finish_reason` will be `length`, and there is no
      // `hadReasoning` signal. Heuristic must accept the terminus.
      expect(
        isPlanningWithoutAction({
          cleanText: '',
          hadToolCall: false,
          hadDelegate: false,
          hadReasoning: false
        })
      ).toBe(false);
    });

    it('does NOT fire when a directive closed normally', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: '',
          hadToolCall: false,
          hadDelegate: true
        })
      ).toBe(false);
    });

    it('does NOT fire on a substantive answer', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: 'I reviewed the bootstrap sequence and confirmed it matches the audit notes.',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });
  });

  describe('clean terminus — narration patterns the host MUST NOT nudge', () => {
    /**
     * These are the cases that earlier symptom-treating heuristics
     * (regex phrase matchers, colon-handoff detectors) would have
     * flagged. They are clean termini under the corrected transport
     * contract — `reasoning_content` is round-tripped on Ollama and
     * OpenAI alike, so a model that planned in reasoning and emitted
     * a brief content announcement carries its plan into the next
     * turn naturally.
     */

    it('does NOT nudge a colon-handoff "let me start by …:"', () => {
      expect(
        isPlanningWithoutAction({
          cleanText: 'Let me start by creating the project structure:',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe(false);
    });

    it('does NOT nudge a "now I\'ll delegate …:" hand-off', () => {
      expect(
        isPlanningWithoutAction({
          cleanText:
            "Now I'll delegate multiple parallel agents to thoroughly analyze different aspects of the codebase. Each agent will focus on a specific area:",
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

  describe('classifyPlanningWithoutAction — variant routing', () => {
    it('returns `reasoning-only` for an empty + reasoning turn', () => {
      expect(
        classifyPlanningWithoutAction({
          cleanText: '',
          hadToolCall: false,
          hadDelegate: false,
          hadReasoning: true
        })
      ).toBe('reasoning-only');
    });

    it('returns `none` for a colon-handoff narration', () => {
      // The narration-loop pathology is a transport-layer concern, not
      // a heuristic concern. The classifier must NOT flag this as a
      // planning failure.
      expect(
        classifyPlanningWithoutAction({
          cleanText: "Now I'll delegate multiple parallel agents to analyze different aspects:",
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe('none');
    });

    it('returns `none` for a substantive answer', () => {
      expect(
        classifyPlanningWithoutAction({
          cleanText: 'I reviewed the bootstrap sequence and confirmed it matches the audit notes.',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe('none');
    });

    it('returns `none` for a clarifying question', () => {
      expect(
        classifyPlanningWithoutAction({
          cleanText: 'Which of these would you like me to tackle first?',
          hadToolCall: false,
          hadDelegate: false
        })
      ).toBe('none');
    });

    it('always returns `none` when `hadToolCall` or `hadDelegate` is true', () => {
      expect(
        classifyPlanningWithoutAction({
          cleanText: '',
          hadToolCall: true,
          hadDelegate: false
        })
      ).toBe('none');
      expect(
        classifyPlanningWithoutAction({
          cleanText: 'Let me start:',
          hadToolCall: false,
          hadDelegate: true
        })
      ).toBe('none');
    });
  });
});
