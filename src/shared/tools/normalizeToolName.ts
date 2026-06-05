/**
 * Normalize provider-emitted tool names to registered catalogue entries.
 * Handles stray whitespace and common namespace prefixes (`functions.finish`).
 */

import type { RegisteredToolName } from '@shared/types/tool.js';

const REGISTERED = new Set<string>([
  'bash',
  'ls',
  'read',
  'edit',
  'delete',
  'search',
  'memory',
  'recall',
  'finish',
  'ask_user'
]);

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

export function isRegisteredToolName(raw: string | undefined | null): boolean {
  return normalizeRegisteredToolName(raw) !== null;
}
