/**
 * Normalize provider-emitted tool names to registered catalogue entries.
 * Handles stray whitespace and common namespace prefixes (`functions.finish`).
 */

import type { RegisteredToolName } from '@shared/types/tool.js';
import { REGISTERED_TOOL_NAMES } from '@shared/types/tool.js';

// Derived from the canonical catalogue so a new tool can never be
// silently un-normalizable (previously `report` was missing here).
const REGISTERED = new Set<string>(REGISTERED_TOOL_NAMES);

export function normalizeRegisteredToolName(
  raw: string | undefined | null
): RegisteredToolName | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (REGISTERED.has(lower)) return lower as RegisteredToolName;
  const base = trimmed.split(/[/:.]/).pop()?.trim().toLowerCase() ?? '';
  if (REGISTERED.has(base)) return base as RegisteredToolName;
  return null;
}
