/**
 * `context` tool — on-demand Agent Skills and legacy context-pack aliases.
 *
 * Skills are SKILL.md workflows discovered from the workspace and user skill
 * directories. A compact catalogue ships in the system prefix; the model loads
 * a skill on demand. Loaded bodies land in the history band (cache-stable prefix).
 */

import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext } from './types.js';
import type { ToolData, ToolResult } from '@shared/types/tool.js';
import { resolveLegacyPackId } from '@shared/types/skills.js';
import { findSkill, getSkillBody, listCatalogueSkills, listSkills } from '../skills/skillRegistry.js';
import { logger } from '../logging/logger.js';

const log = logger.child('tools/context');

const loadedSkillsByRun = new WeakMap<AbortSignal, Set<string>>();
const listedByRun = new WeakMap<AbortSignal, boolean>();
const invokedSkillsByRun = new WeakMap<AbortSignal, Set<string>>();

/** Seed per-run invoked skill names (slash invoke + follow-ups). */
export function seedInvokedSkills(signal: AbortSignal, names: readonly string[]): void {
  let set = invokedSkillsByRun.get(signal);
  if (!set) {
    set = new Set<string>();
    invokedSkillsByRun.set(signal, set);
  }
  for (const n of names) {
    const trimmed = n.trim();
    if (trimmed) set.add(trimmed);
  }
}

function getInvokedSkills(signal: AbortSignal): Set<string> {
  return invokedSkillsByRun.get(signal) ?? new Set<string>();
}

interface ContextArgs {
  action: 'list' | 'load';
  skill?: string;
  /** @deprecated Use `skill`. Legacy context-pack alias. */
  pack?: string;
}

export const contextTool: Tool = {
  name: 'context',
  briefMarkdown: `### Tool: \`context\`

**WHAT it is.** Loads on-demand **Agent Skills** — SKILL.md workflows kept OUT of your always-on system prompt (built-in reference skills, workspace skills, global skills). You decide when a skill is worth its tokens.

**HOW to use it.** The main action is \`load\`:

\`\`\`json
{ "name": "context", "arguments": { "action": "load", "skill": "ast-grep-reference" } }
\`\`\`

The skills catalogue already ships in your system prompt (under "On-Demand Skills"), so you usually do **not** need \`action:"list"\` — just \`load\` the skill you need.

**WHY it exists.** The static prefix carries inviolable rules and tool briefs. Skill bodies load on demand so the prefix stays cache-stable. A loaded skill returns as a tool result in this run's history.

**WHEN to trigger it.**
- Before ast-grep patterns → load \`ast-grep-reference\`.
- Before large deliverables or \`report\` → load \`deliverables\`.
- For tool-call shape examples → load \`static-examples\`.
- Before \`finish\` on multi-step or publishable work → load \`review-checklist\`.
- For recurring / scheduled pipeline design → load \`pipeline-recipes\`.
- When a user or catalogue description matches a workspace skill → load that skill by name.
- When the user typed \`/skill-name\` → load that skill first.

**Notes.** Re-loading dedupes to a short banner. Tier-3 attachments (\`references/\`, \`scripts/\`) are loaded with \`read\` per SKILL.md instructions.`,
  schema: {
    type: 'function',
    function: {
      name: 'context',
      description:
        'Load on-demand Agent Skills (SKILL.md workflows). action="list" enumerates skills; action="load" returns a skill body (requires skill). Legacy pack= alias still accepted.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'load'] },
          skill: {
            type: 'string',
            description:
              'For action="load": skill name from the in-prompt catalogue or action="list".'
          },
          pack: {
            type: 'string',
            description: 'Deprecated alias for skill (legacy context-pack ids).'
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

    try {
      if (a.action === 'list') {
        return runList(id, started, ctx);
      }
      return runLoad(a, id, started, ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('context tool threw', { action: a.action, skill: a.skill, pack: a.pack, error: msg });
      return fail(id, started, `context error: ${msg}`, msg);
    }
  }
};

async function runList(id: string, started: number, ctx: ToolContext): Promise<ToolResult> {
  if (listedByRun.get(ctx.signal)) {
    const banner =
      '[context] You already listed skills this run — the catalogue also ships in your system prompt under "On-Demand Skills". Use `action:"load"` with a skill name when you need one.';
    return ok(id, started, banner, {
      tool: 'context',
      action: 'list',
      alreadyListed: true,
      preview: banner
    });
  }

  const invoked = [...getInvokedSkills(ctx.signal)];
  const skills = await listCatalogueSkills(ctx.workspacePath, invoked);
  const lines: string[] = ['# Skills (load with `context` action="load")'];
  for (const s of skills) {
    const pathNote = s.paths?.length ? ` Paths: ${s.paths.join(', ')}.` : '';
    const manualNote = s.disableModelInvocation ? ' [manual invoke only]' : '';
    lines.push(`- \`${s.name}\` [${s.source}]${manualNote} — ${s.description}${pathNote}`);
  }
  const body = lines.join('\n');
  listedByRun.set(ctx.signal, true);
  log.debug('context skills listed', { count: skills.length });
  return ok(id, started, body, {
    tool: 'context',
    action: 'list',
    alreadyListed: false,
    preview: body
  });
}

async function runLoad(
  a: Partial<ContextArgs>,
  id: string,
  started: number,
  ctx: ToolContext
): Promise<ToolResult> {
  const rawSkill =
    typeof a.skill === 'string' && a.skill.trim()
      ? a.skill.trim()
      : typeof a.pack === 'string' && a.pack.trim()
        ? resolveLegacyPackId(a.pack.trim())
        : '';
  if (!rawSkill) {
    return fail(
      id,
      started,
      'Error: `skill` is required for action="load". Call action="list" to see names.',
      'missing skill'
    );
  }

  const meta = await findSkill(rawSkill, ctx.workspacePath);
  if (!meta) {
    const invoked = [...getInvokedSkills(ctx.signal)];
    const names = await listCatalogueSkills(ctx.workspacePath, invoked);
    const valid = names.map((s) => s.name).join(', ');
    log.warn('context load requested unknown skill', { skill: rawSkill });
    return fail(
      id,
      started,
      `Error: unknown skill "${rawSkill}". Valid names: ${valid || '(none)'}.`,
      'unknown skill'
    );
  }

  const invoked = getInvokedSkills(ctx.signal);
  if (meta.disableModelInvocation && !invoked.has(meta.name)) {
    const manualOnly = (await listSkills(ctx.workspacePath))
      .filter((s) => s.disableModelInvocation)
      .map((s) => s.name);
    return fail(
      id,
      started,
      `Error: skill "${meta.name}" is manual-invoke only. User must type /${meta.name} in the composer or explicitly request it. Manual-only skills: ${manualOnly.join(', ') || '(none)'}.`,
      'manual invoke required'
    );
  }

  let loaded = loadedSkillsByRun.get(ctx.signal);
  if (!loaded) {
    loaded = new Set<string>();
    loadedSkillsByRun.set(ctx.signal, loaded);
  }
  if (loaded.has(meta.name)) {
    log.debug('context skill re-load deduped', { skill: meta.name });
    const banner = `[context] Skill "${meta.name}" is already loaded earlier in this run — scroll back to that tool result instead of re-loading.`;
    return ok(id, started, banner, {
      tool: 'context',
      action: 'load',
      skill: meta.name,
      source: meta.source,
      pack: meta.name,
      alreadyLoaded: true,
      preview: banner
    });
  }

  const body = await getSkillBody(meta.name, ctx.workspacePath);
  if (!body || body.trim().length === 0) {
    log.warn('context skill body unavailable', { skill: meta.name });
    return fail(
      id,
      started,
      `Error: skill "${meta.name}" is currently unavailable (empty body). Proceed without it or fix the SKILL.md file.`,
      'empty skill body'
    );
  }

  loaded.add(meta.name);
  const header = `# Skill: ${meta.name} (\`${meta.name}\`)\n`;
  const output = `${header}\n${body}`;
  log.info('context skill loaded', { skill: meta.name, source: meta.source, chars: output.length });
  return ok(id, started, output, {
    tool: 'context',
    action: 'load',
    skill: meta.name,
    source: meta.source,
    pack: meta.name,
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
