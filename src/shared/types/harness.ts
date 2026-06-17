/** Editable harness markdown sections (natural-language OS). */

export const HARNESS_SECTION_IDS = [
  'orchestrator-core',
  'context-learning',
  'deliverables',
  'static-examples',
  'ast-grep-reference',
  'phased-execution'
] as const;

export type HarnessSectionId = (typeof HARNESS_SECTION_IDS)[number];

export interface HarnessSectionInfo {
  id: HarnessSectionId;
  file: string;
  hasOverride: boolean;
}

export interface HarnessSectionReadResult {
  sectionId: HarnessSectionId;
  bundled: string;
  override: string | null;
  effective: string;
}
