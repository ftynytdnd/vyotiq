/**
 * `context` tool — on-demand reference "context packs".
 *
 * The harness keeps the static system prefix lean: reference material
 * (ast-grep syntax, deliverables/report guidance, tool-use examples) is NOT
 * force-fed every turn. Instead a short catalogue advertises the packs in the
 * prefix and the model loads one itself, on demand, with this tool. A loaded
 * pack returns as a tool result and lands in the run's history band — so it is
 * recoverable but never bloats the cached prefix.
 *
 * Two actions:
 *   - `list`: enumerate available packs (id, title, summary, load-when). The
 *     same catalogue already ships in the system prefix, so `list` is rarely
 *     needed; a second `list` in a run is deduped to a one-line banner.
 *   - `load`: return one pack's full markdown body. Re-loading the same pack
 *     within a run is deduped to a one-line banner so repeated loads do not
 *     burn context — the earlier copy is already in history.
 *
 * The tool self-governs repeats (graceful `ok:true` banners) and is excluded
 * from the host's generic duplicate-call blocker (`toolCallDedupe.ts`), so a
 * model that re-issues a `context` call is nudged, never hit with a hostile
 * `BLOCKED` message.
 */

import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext } from './types.js';
import type { ToolData, ToolResult } from '@shared/types/tool.js';
import type { ContextPackId } from '@shared/types/harness.js';
import { CONTEXT_PACKS, isContextPackId } from '@shared/types/harness.js';
import { getContextPackBody } from '../harness/contextPacks.js';
import { logger } from '../logging/logger.js';

const log = logger.child('tools/context');

/**
 * Per-run set of packs already loaded, keyed by the run's `AbortSignal`.
 * `WeakMap` ties the lifetime to the run: when the signal is GC'd the entry
 * vanishes — no explicit teardown (same contract `recall` uses for its
 * self-recall guard).
 */
const loadedPacksByRun = new WeakMap<AbortSignal, Set<string>>();

/**
 * Per-run flag tracking whether the catalogue was already listed. Same
 * lifetime contract as `loadedPacksByRun` — the entry GCs with the signal.
 * A second `list` in the run returns a short banner instead of re-emitting
 * the full catalogue (which already ships in the system prefix).
 */
const listedByRun = new WeakMap<AbortSignal, boolean>();

interface ContextArgs {
  action: 'list' | 'load';
  pack?: string;
}

function packIdEnum(): string[] {
  return CONTEXT_PACKS.map((p) => p.id);
}

export const contextTool: Tool = {
  name: 'context',
  briefMarkdown: `### Tool: \`context\`

**WHAT it is.** Loads on-demand reference "context packs" that are intentionally kept OUT of your always-on system prompt (ast-grep syntax, deliverables/report guidance, tool-use examples). You decide when reference material is worth its tokens.

**HOW to use it.** The main action is \`load\`:

\`\`\`json
{ "name": "context", "arguments": { "action": "load", "pack": "ast-grep-reference" } }
\`\`\`

The pack catalogue already ships in your system prompt (under "On-Demand Context Packs"), so you usually do **not** need \`action:"list"\` — just \`load\` the pack you need.

**WHY it exists.** The system prefix carries only your inviolable rules, context/memory protocol, and loop behavior. Reference packs are loaded on demand so the static prefix stays cache-stable and cheap. A loaded pack returns as a tool result and stays in this run's history.

**WHEN to trigger it.**
- Before writing ast-grep \`search\` / \`sg\` patterns or YAML rules → load \`ast-grep-reference\`.
- Before a large/tabular deliverable or a \`report\` call → load \`deliverables\`.
- When you want a concrete example of correct tool-call shape → load \`static-examples\`.

**Notes.** Load a pack only when a step actually needs it — do not pre-load packs "to demonstrate". Re-loading a pack (or re-listing) you already pulled this run returns a short banner (the earlier copy / the in-prefix catalogue already has it), so repeats are harmless but wasteful.`,
  schema: {
    type: 'function',
    function: {
      name: 'context',
      description:
        'Load on-demand reference context packs that are kept out of the static system prompt. action="list" enumerates packs (id, title, summary, load-when); action="load" returns a pack body (requires pack).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'load'] },
          pack: {
            type: 'string',
            enum: packIdEnum(),
            description:
              'For action="load": which pack to load. Take the id from action="list" or the in-prompt pack catalogue.'
          }
        },
        required: ['action']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<ContextArgs>;

    if (a.action !== 'list' && a.action !== 'load') {
      log.warn('context called with invalid action', { action: String(a.action) });
      return fail(id, started, `Error: unknown action "${String(a.action)}".`, 'invalid action');
    }

    // Defense in depth: the actions below are pure (catalogue text / in-memory
    // pack bodies) so they should not throw, but a top-level guard keeps a
    // surprise (e.g. a future IO-backed pack source) from escaping as an
    // unhandled rejection — it surfaces as a graceful `ok:false` result the
    // model can react to, mirroring the `recall` tool's contract.
    try {
      if (a.action === 'list') {
        return runList(id, started, ctx);
      }
      return runLoad(a, id, started, ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('context tool threw', {
        action: a.action,
        pack: a.pack,
        error: msg
      });
      return fail(id, started, `context error: ${msg}`, msg);
    }
  }
};

function runList(id: string, started: number, ctx: ToolContext): ToolResult {
  if (listedByRun.get(ctx.signal)) {
    const banner =
      '[context] You already listed the packs this run — the same catalogue also ships in your system prompt under "On-Demand Context Packs". Use `action:"load"` with a pack id when you actually need one.';
    return ok(id, started, banner, {
      tool: 'context',
      action: 'list',
      alreadyListed: true,
      preview: banner
    });
  }

  const lines: string[] = ['# Context packs (load with `context` action="load")'];
  for (const p of CONTEXT_PACKS) {
    lines.push(`- \`${p.id}\` — ${p.title}. ${p.summary} Load when: ${p.loadWhen}`);
  }
  const body = lines.join('\n');
  listedByRun.set(ctx.signal, true);
  log.debug('context catalogue listed', { packs: CONTEXT_PACKS.length });
  return ok(id, started, body, {
    tool: 'context',
    action: 'list',
    alreadyListed: false,
    preview: body
  });
}

function runLoad(
  a: Partial<ContextArgs>,
  id: string,
  started: number,
  ctx: ToolContext
): ToolResult {
  const pack = typeof a.pack === 'string' ? a.pack.trim() : '';
  if (!pack) {
    return fail(
      id,
      started,
      'Error: `pack` is required for action="load". Call action="list" to see ids.',
      'missing pack'
    );
  }
  if (!isContextPackId(pack)) {
    log.warn('context load requested an unknown pack', { pack });
    return fail(
      id,
      started,
      `Error: unknown pack "${pack}". Valid ids: ${packIdEnum().join(', ')}.`,
      'unknown pack'
    );
  }

  const packId: ContextPackId = pack;
  let loaded = loadedPacksByRun.get(ctx.signal);
  if (!loaded) {
    loaded = new Set<string>();
    loadedPacksByRun.set(ctx.signal, loaded);
  }
  if (loaded.has(packId)) {
    log.debug('context pack re-load deduped', { pack: packId });
    const banner = `[context] Pack "${packId}" is already loaded earlier in this run — scroll back to that tool result instead of re-loading.`;
    return ok(id, started, banner, {
      tool: 'context',
      action: 'load',
      pack: packId,
      alreadyLoaded: true,
      preview: banner
    });
  }

  const meta = CONTEXT_PACKS.find((p) => p.id === packId);
  const body = getContextPackBody(packId).trim();
  // Defensive: `getContextPackBody` already falls back to the bundled body and
  // never returns `undefined`, but if a pack genuinely resolves empty (e.g. a
  // user saved a blank override and the bundled body is somehow missing) we
  // fail gracefully instead of returning a header with no content.
  if (body.length === 0) {
    log.warn('context pack body unavailable', { pack: packId });
    return fail(
      id,
      started,
      `Error: pack "${packId}" is currently unavailable (empty body). Proceed without it, or reset it in Settings → Agent behavior → Harness.`,
      'empty pack body'
    );
  }
  loaded.add(packId);
  const header = `# Context pack: ${meta?.title ?? packId} (\`${packId}\`)\n`;
  const output = `${header}\n${body}`;
  log.info('context pack loaded', { pack: packId, chars: output.length });
  return ok(id, started, output, {
    tool: 'context',
    action: 'load',
    pack: packId,
    alreadyLoaded: false,
    preview: output
  });
}

function ok(id: string, started: number, output: string, data: ToolData): ToolResult {
  return { id, name: 'context', ok: true, output, data, durationMs: Date.now() - started };
}

function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'context', ok: false, output, error, durationMs: Date.now() - started };
}
