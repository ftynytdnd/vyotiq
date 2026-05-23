/**
 * Deep validation for `contextSummary:updateRules` patches.
 */

import type { ContextSummaryRules } from '@shared/types/contextSummary.js';
import {
  assertBoolean,
  assertEnum,
  assertNumber,
  assertObject,
  assertString
} from './validate.js';

const MESSAGE_KINDS = [
  'user',
  'assistant',
  'assistant-tool-call',
  'tool-result',
  'delegate-result',
  'system-summary'
] as const;

const KIND_POLICIES = ['keep', 'summarize', 'drop', 'auto'] as const;
const DROPPED_MARKER_STYLES = ['omit', 'placeholder'] as const;

const PATCH_KEYS = new Set([
  'enabled',
  'autoTriggerRatio',
  'keepRecentTurns',
  'preserveUserPromptsAlways',
  'preserveFirstSystem',
  'minMessagesToSummarize',
  'maxRetries',
  'summarizerSelection',
  'perKindPolicy',
  'droppedMarkerStyle'
]);

export function assertContextSummaryRulesPatch(
  channel: string,
  patch: Partial<ContextSummaryRules>
): void {
  assertObject(channel, 'patch', patch);
  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.has(key)) {
      throw new Error(`${channel}: patch.${key} is not a recognized contextSummary field`);
    }
  }
  const p = patch as Record<string, unknown>;
  if ('enabled' in p && p.enabled !== undefined) {
    assertBoolean(channel, 'patch.enabled', p.enabled);
  }
  if ('autoTriggerRatio' in p && p.autoTriggerRatio !== undefined) {
    assertNumber(channel, 'patch.autoTriggerRatio', p.autoTriggerRatio);
    const ratio = p.autoTriggerRatio as number;
    if (ratio < 0 || ratio > 1) {
      throw new Error(`${channel}: patch.autoTriggerRatio must be between 0 and 1`);
    }
  }
  if ('keepRecentTurns' in p && p.keepRecentTurns !== undefined) {
    assertNumber(channel, 'patch.keepRecentTurns', p.keepRecentTurns);
    if ((p.keepRecentTurns as number) < 0) {
      throw new Error(`${channel}: patch.keepRecentTurns must be >= 0`);
    }
  }
  if ('preserveUserPromptsAlways' in p && p.preserveUserPromptsAlways !== undefined) {
    assertBoolean(channel, 'patch.preserveUserPromptsAlways', p.preserveUserPromptsAlways);
  }
  if ('preserveFirstSystem' in p && p.preserveFirstSystem !== undefined) {
    assertBoolean(channel, 'patch.preserveFirstSystem', p.preserveFirstSystem);
  }
  if ('minMessagesToSummarize' in p && p.minMessagesToSummarize !== undefined) {
    assertNumber(channel, 'patch.minMessagesToSummarize', p.minMessagesToSummarize);
    if ((p.minMessagesToSummarize as number) < 0) {
      throw new Error(`${channel}: patch.minMessagesToSummarize must be >= 0`);
    }
  }
  if ('maxRetries' in p && p.maxRetries !== undefined) {
    assertNumber(channel, 'patch.maxRetries', p.maxRetries);
    if ((p.maxRetries as number) < 0) {
      throw new Error(`${channel}: patch.maxRetries must be >= 0`);
    }
  }
  if ('summarizerSelection' in p && p.summarizerSelection !== undefined && p.summarizerSelection !== null) {
    assertObject(channel, 'patch.summarizerSelection', p.summarizerSelection);
    const sel = p.summarizerSelection as Record<string, unknown>;
    assertString(channel, 'patch.summarizerSelection.providerId', sel.providerId);
    assertString(channel, 'patch.summarizerSelection.modelId', sel.modelId);
  }
  if ('droppedMarkerStyle' in p && p.droppedMarkerStyle !== undefined) {
    assertEnum(channel, 'patch.droppedMarkerStyle', p.droppedMarkerStyle, DROPPED_MARKER_STYLES);
  }
  if ('perKindPolicy' in p && p.perKindPolicy !== undefined) {
    assertObject(channel, 'patch.perKindPolicy', p.perKindPolicy);
    const map = p.perKindPolicy as Record<string, unknown>;
    for (const [kind, policy] of Object.entries(map)) {
      assertEnum(channel, 'patch.perKindPolicy key', kind, MESSAGE_KINDS);
      assertEnum(channel, `patch.perKindPolicy[${kind}]`, policy, KIND_POLICIES);
    }
  }
}
