/**
 * Classify multi-step prompts for phased execution mode.
 */

import type { PhasedExecutionMode } from '@shared/types/phased.js';

const MULTI_STEP_PATTERNS: readonly RegExp[] = [
  /\b(implement|build|refactor|migrate|add feature|fix bug|write tests?)\b/i,
  /\b(step[- ]by[- ]step|multi[- ]file|across (the )?codebase)\b/i,
  /\b(create|update|modify)\s+.+\s+(and|then)\s+/i,
  /\b(end[- ]to[- ]end|full (build|test|verification))\b/i
];

const SIMPLE_PATTERNS: readonly RegExp[] = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)[!.?\s]*$/i,
  /^(what is|who is|define|explain)\s+.+\?$/i,
  /^how (do|does|can|should) .+\?$/i
];

export function classifyPromptForPhasedMode(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length < 12) return false;
  if (SIMPLE_PATTERNS.some((re) => re.test(trimmed))) return false;
  if (MULTI_STEP_PATTERNS.some((re) => re.test(trimmed))) return true;
  if (trimmed.length > 180) return true;
  if ((trimmed.match(/\n/g) ?? []).length >= 2) return true;
  return false;
}

export function resolvePhasedModeActive(
  mode: PhasedExecutionMode,
  prompt: string,
  runtimeActive?: boolean
): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  if (typeof runtimeActive === 'boolean') return runtimeActive;
  return classifyPromptForPhasedMode(prompt);
}
