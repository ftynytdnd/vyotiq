/**
 * Harness IPC — read/write user overrides for natural-language sections.
 */

import { IPC } from '@shared/constants.js';
import {
  listHarnessSections,
  readHarnessOverride,
  writeHarnessOverride,
  resetHarnessOverride,
  isHarnessSectionId
} from '../harness/harnessOverrides.js';
import {
  readBundledHarnessSection,
  invalidateHarnessPromptCache,
  warmHarnessOverrides
} from '../harness/harnessLoader.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertString } from './validate.js';

export function registerHarnessIpc(): void {
  wrapIpcHandler(IPC.HARNESS_LIST_SECTIONS, async () => listHarnessSections());

  wrapIpcHandler(IPC.HARNESS_READ_SECTION, async (_event, sectionId: string) => {
    assertString('harness:readSection', 'sectionId', sectionId);
    if (!isHarnessSectionId(sectionId)) {
      throw new Error(`harness:readSection: unknown sectionId "${sectionId}"`);
    }
    const override = await readHarnessOverride(sectionId);
    const bundled = readBundledHarnessSection(sectionId);
    return {
      sectionId,
      bundled,
      override,
      effective: override ?? bundled
    };
  });

  wrapIpcHandler(
    IPC.HARNESS_WRITE_SECTION,
    async (_event, sectionId: string, body: string) => {
      assertString('harness:writeSection', 'sectionId', sectionId);
      assertString('harness:writeSection', 'body', body);
      if (!isHarnessSectionId(sectionId)) {
        throw new Error(`harness:writeSection: unknown sectionId "${sectionId}"`);
      }
      await writeHarnessOverride(sectionId, body);
      invalidateHarnessPromptCache();
      await warmHarnessOverrides();
      return { ok: true as const };
    }
  );

  wrapIpcHandler(IPC.HARNESS_RESET_SECTION, async (_event, sectionId: string) => {
    assertString('harness:resetSection', 'sectionId', sectionId);
    if (!isHarnessSectionId(sectionId)) {
      throw new Error(`harness:resetSection: unknown sectionId "${sectionId}"`);
    }
    await resetHarnessOverride(sectionId);
    invalidateHarnessPromptCache();
    await warmHarnessOverrides();
    return { ok: true as const };
  });
}
