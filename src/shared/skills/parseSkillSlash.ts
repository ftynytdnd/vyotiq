/**
 * Parse `/skill-name` slash invocations (composer, scheduled runs, heartbeat).
 */

import { resolveSkillAlias } from './skillAliases.js';

export interface ParsedSkillSlash {
  /** Canonical skill name without leading slash, or null if not a slash invoke. */
  invokedSkill: string | null;
  /** Slash token as typed (may be an alias). */
  slashToken: string | null;
  /** Remaining user prompt after stripping the slash token. */
  prompt: string;
}

const SKILL_SLASH_RE = /^\/([a-z0-9][a-z0-9-]*)\s*(.*)$/s;

export function parseSkillSlashInput(raw: string): ParsedSkillSlash {
  const trimmed = raw.trim();
  const match = SKILL_SLASH_RE.exec(trimmed);
  if (!match) {
    return { invokedSkill: null, slashToken: null, prompt: raw };
  }
  const slashToken = match[1] ?? null;
  const invokedSkill = slashToken ? resolveSkillAlias(slashToken) : null;
  const rest = (match[2] ?? '').trim();
  return {
    invokedSkill,
    slashToken,
    prompt: rest.length > 0 ? rest : `Invoke skill /${slashToken}`
  };
}

/** Prompt + optional invokedSkill for automation dispatch (scheduler, heartbeat). */
export function parseAutomationPrompt(raw: string): { prompt: string; invokedSkill?: string } {
  const parsed = parseSkillSlashInput(raw);
  return {
    prompt: parsed.prompt,
    ...(parsed.invokedSkill ? { invokedSkill: parsed.invokedSkill } : {})
  };
}
