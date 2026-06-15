/**
 * User-editable harness overrides stored under userData.
 * Bundled defaults live in `src/main/harness/*.md`; overrides replace
 * matching sections at runtime without rebuilding the app.
 */

import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessSectionId, HarnessSectionInfo } from '@shared/types/harness.js';
import { HARNESS_SECTION_IDS } from '@shared/types/harness.js';
import { harnessOverridesDir } from '../paths/userDataLayout.js';
import { logger } from '../logging/logger.js';

const log = logger.child('harness/overrides');

export type { HarnessSectionId, HarnessSectionInfo };
export { HARNESS_SECTION_IDS };

const SECTION_TO_FILE: Record<HarnessSectionId, string> = {
  'orchestrator-core': '00-orchestrator-core.md',
  'context-learning': '01-context-learning.md',
  deliverables: '02-deliverables.md',
  'static-examples': '03-static-examples.md',
  'ast-grep-reference': '04-ast-grep-cheatsheet.md'
};

function overridesDir(): string {
  return harnessOverridesDir();
}

function overridePath(sectionId: HarnessSectionId): string {
  return join(overridesDir(), SECTION_TO_FILE[sectionId]);
}

export function isHarnessSectionId(id: string): id is HarnessSectionId {
  return (HARNESS_SECTION_IDS as readonly string[]).includes(id);
}

export function listHarnessSections(): HarnessSectionInfo[] {
  return HARNESS_SECTION_IDS.map((id) => ({
    id,
    file: SECTION_TO_FILE[id],
    hasOverride: existsSync(overridePath(id))
  }));
}

export async function readHarnessOverride(sectionId: HarnessSectionId): Promise<string | null> {
  const path = overridePath(sectionId);
  if (!existsSync(path)) return null;
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    log.warn('read override failed', { sectionId, err });
    return null;
  }
}

export async function writeHarnessOverride(
  sectionId: HarnessSectionId,
  body: string
): Promise<void> {
  await fs.mkdir(overridesDir(), { recursive: true });
  const path = overridePath(sectionId);
  const tmp = `${path}.tmp`;
  try {
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, path);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* noop */
    }
    throw err;
  }
}

export async function resetHarnessOverride(sectionId: HarnessSectionId): Promise<void> {
  const path = overridePath(sectionId);
  try {
    await fs.unlink(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}
