/**
 * On-demand context packs — reference material the model loads itself via the
 * `context` tool instead of carrying it in the always-on system prefix.
 *
 * This module owns the pack markdown bodies (override-aware) and the in-prefix
 * catalogue text. It deliberately does NOT import the tool registry, so the
 * `context` tool can depend on it without creating an import cycle
 * (`registry → context.tool → harnessLoader → registry`).
 */

import type { ContextPackId } from '@shared/types/harness.js';
import { CONTEXT_PACK_IDS, CONTEXT_PACKS } from '@shared/types/harness.js';
import { readHarnessOverride } from './harnessOverrides.js';
import { logger } from '../logging/logger.js';

import deliverables from './02-deliverables.md?raw';
import staticExamples from './03-static-examples.md?raw';
import astGrepReference from './04-ast-grep-cheatsheet.md?raw';

const log = logger.child('harness/contextPacks');

const BUNDLED_PACK_BODIES: Record<ContextPackId, string> = {
  'ast-grep-reference': astGrepReference,
  deliverables: deliverables,
  'static-examples': staticExamples
};

export function readBundledContextPack(id: ContextPackId): string {
  return BUNDLED_PACK_BODIES[id];
}

let packBodiesCache: Record<ContextPackId, string> | null = null;

/**
 * Resolve one pack body (override-aware). Never throws — a failed override
 * read (already swallowed + logged inside `readHarnessOverride`) or an empty
 * override falls back to the bundled body, and an empty bundled body is logged
 * loudly and returned as '' so the caller can decide (the boot assert catches
 * this earlier in normal operation).
 */
async function resolvePackBody(id: ContextPackId): Promise<string> {
  try {
    const override = await readHarnessOverride(id);
    if (override !== null && override.trim().length > 0) {
      log.debug('context pack override applied', { pack: id, chars: override.length });
      return override;
    }
  } catch (err) {
    log.warn('context pack override read failed; using bundled body', { pack: id, err });
  }
  const bundled = BUNDLED_PACK_BODIES[id];
  if (typeof bundled !== 'string' || bundled.trim().length === 0) {
    log.error('bundled context pack body empty', { pack: id });
    return '';
  }
  return bundled;
}

/**
 * Load pack overrides into memory. Called from `warmHarnessOverrides`.
 * Resilient: any failure leaves the cache null so `getContextPackBody`
 * transparently falls back to the bundled bodies rather than crashing boot
 * or a harness-edit IPC.
 */
export async function warmContextPacks(): Promise<void> {
  try {
    const entries = await Promise.all(
      CONTEXT_PACK_IDS.map(async (id) => [id, await resolvePackBody(id)] as const)
    );
    packBodiesCache = Object.fromEntries(entries) as Record<ContextPackId, string>;
    log.debug('context packs warmed', { count: entries.length });
  } catch (err) {
    log.error('warming context packs failed; falling back to bundled bodies', { err });
    packBodiesCache = null;
  }
}

export function invalidateContextPacks(): void {
  packBodiesCache = null;
}

/**
 * Resolve the markdown body of a pack (override-aware). Returned to the model
 * by the `context` tool — never embedded in the static prefix. Falls back to
 * the bundled body before overrides are warmed, and is defensive against a
 * partially-populated cache so the caller never receives `undefined` (which
 * would crash a downstream `.trim()`).
 */
export function getContextPackBody(id: ContextPackId): string {
  const cached = packBodiesCache?.[id];
  if (typeof cached === 'string' && cached.trim().length > 0) return cached;

  const bundled = BUNDLED_PACK_BODIES[id];
  if (typeof bundled === 'string' && bundled.trim().length > 0) {
    if (packBodiesCache) {
      log.warn('context pack body missing from cache; using bundled fallback', { pack: id });
    }
    return bundled;
  }

  log.error('context pack body unavailable (cache and bundled both empty)', { pack: id });
  return '';
}

/** Boot check: every pack must have a non-empty bundled body. */
export function assertContextPacksPresent(): void {
  for (const id of CONTEXT_PACK_IDS) {
    const body = BUNDLED_PACK_BODIES[id];
    if (typeof body !== 'string' || body.trim().length === 0) {
      throw new Error(`harness boot: context pack "${id}" missing or empty`);
    }
  }
}

/**
 * The in-prefix catalogue of on-demand packs. Lists what is loadable and when,
 * so the model — not a host heuristic — decides which reference material to
 * pull. Pack bodies are NOT in the prefix; loading one via the `context` tool
 * injects it into this run's history.
 */
export function buildContextPackCatalogue(): string {
  const lines = CONTEXT_PACKS.map(
    (p) => `- \`${p.id}\` — ${p.title}. ${p.summary} Load when: ${p.loadWhen}`
  );
  return (
    `# On-Demand Context Packs\n\n` +
    `Reference material is not force-fed every turn. The full catalogue is right\n` +
    `here, so you do not need \`action:"list"\` — when a step needs one of the packs\n` +
    `below, load it yourself with the \`context\` tool. It returns as a tool result and\n` +
    `stays in this run's history (re-loading the same pack is deduped). Load only when\n` +
    `a step actually needs it — do not pre-load packs:\n\n` +
    '```json\n' +
    '{ "name": "context", "arguments": { "action": "load", "pack": "ast-grep-reference" } }\n' +
    '```\n\n' +
    `Available packs:\n\n` +
    lines.join('\n')
  );
}
