/** Editable harness markdown sections (natural-language OS). */

export const HARNESS_SECTION_IDS = [
  'orchestrator-core',
  'context-learning',
  'deliverables',
  'static-examples',
  'ast-grep-reference',
  'dynamic-loop'
] as const;

export type HarnessSectionId = (typeof HARNESS_SECTION_IDS)[number];

/**
 * Where an editable section lives in the prompt:
 *   - `prefix` — always-on, concatenated into the cached `<system_instructions>`
 *     system slot every turn (identity + inviolable rules + loop behavior).
 *   - `pack`   — an on-demand "context pack" the model loads itself via the
 *     `context` tool when relevant. Never force-fed into the static prefix;
 *     a short catalogue advertises it so the model decides when to pull it.
 */
export type HarnessPlacement = 'prefix' | 'pack';

/** Single source of truth for which sections are always-on vs on-demand. */
export const HARNESS_SECTION_PLACEMENT: Record<HarnessSectionId, HarnessPlacement> = {
  'orchestrator-core': 'prefix',
  'context-learning': 'prefix',
  'dynamic-loop': 'prefix',
  'ast-grep-reference': 'pack',
  deliverables: 'pack',
  'static-examples': 'pack'
};

/** Always-on sections, in the order they appear in the system prefix. */
export const HARNESS_PREFIX_SECTION_IDS = [
  'orchestrator-core',
  'context-learning',
  'dynamic-loop'
] as const satisfies readonly HarnessSectionId[];

/** On-demand context packs the model can load via the `context` tool. */
export const CONTEXT_PACK_IDS = [
  'ast-grep-reference',
  'deliverables',
  'static-examples'
] as const satisfies readonly HarnessSectionId[];

export type ContextPackId = (typeof CONTEXT_PACK_IDS)[number];

export function isContextPackId(id: string): id is ContextPackId {
  return (CONTEXT_PACK_IDS as readonly string[]).includes(id);
}

/**
 * Display + catalogue metadata for an on-demand pack. `summary` and
 * `loadWhen` drive both the in-prefix catalogue (so the model knows what
 * it can pull and when) and the Settings UI grouping. The body is resolved
 * separately from the section markdown (override-aware) by the harness loader.
 */
export interface ContextPackMeta {
  id: ContextPackId;
  title: string;
  summary: string;
  loadWhen: string;
}

export const CONTEXT_PACKS: readonly ContextPackMeta[] = [
  {
    id: 'ast-grep-reference',
    title: 'ast-grep structural search',
    summary: 'Metavariables, search/sg JSON shapes, YAML rules, and node kinds.',
    loadWhen: 'Before writing ast-grep `search` / `sg` patterns, YAML rules, or structural rewrites.'
  },
  {
    id: 'deliverables',
    title: 'Deliverables — Markdown vs HTML reports',
    summary: 'When to keep timeline Markdown vs emit an HTML `report`, plus report CSS classes.',
    loadWhen: 'Before producing a large or tabular deliverable, or calling the `report` tool.'
  },
  {
    id: 'static-examples',
    title: 'Tool-use examples',
    summary: 'Worked examples: read-before-edit, AST search, ask_user, PowerShell-safe bash, sg rewrite.',
    loadWhen: 'When you want a concrete example of the correct tool-call shape for a common task.'
  }
];

export interface HarnessSectionInfo {
  id: HarnessSectionId;
  file: string;
  placement: HarnessPlacement;
  hasOverride: boolean;
}

export interface HarnessSectionReadResult {
  sectionId: HarnessSectionId;
  bundled: string;
  override: string | null;
  effective: string;
}
