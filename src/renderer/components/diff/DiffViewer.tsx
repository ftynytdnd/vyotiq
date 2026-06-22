/**
 * Shared diff viewer — unified / split layout toggle plus rendering.
 * Used by timeline revert rows, floating live diff, and edit approval.
 */

import { useEffect } from 'react';
import type { DiffHunk } from '@shared/types/tool.js';
import type { DiffViewVariant } from '../timeline/tools/edit/diff/DiffHunk.js';
import type { ReviewLinePickProps } from '../timeline/tools/edit/diff/diffLinePick.js';
import { persistSettingsPatch } from '../../lib/persistSettingsPatch.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { DiffLayoutToggle } from './DiffLayoutToggle.js';
import { SplitDiffViewer } from './SplitDiffViewer.js';
import { UnifiedDiffBody } from './UnifiedDiffBody.js';
import {
  resolveDiffLayoutPref,
  takeLegacyDiffLayoutPref,
  type DiffLayoutMode
} from './diffLayoutPref.js';

export interface DiffViewerProps {
  hunks: DiffHunk[];
  variant: DiffViewVariant;
  maxHeightClass?: string;
  linePick?: ReviewLinePickProps;
  /** Hide layout toggle (e.g. streaming partial diffs). Defaults true. */
  showLayoutToggle?: boolean;
}

export function DiffViewer({
  hunks,
  variant,
  maxHeightClass,
  linePick,
  showLayoutToggle = true
}: DiffViewerProps) {
  const settingsUi = useSettingsStore((s) => s.settings.ui);
  const layout = resolveDiffLayoutPref(settingsUi);

  useEffect(() => {
    const legacy = takeLegacyDiffLayoutPref(settingsUi);
    if (!legacy) return;
    void persistSettingsPatch({ ui: { diffLayout: legacy } });
  }, [settingsUi]);

  const onLayoutChange = (mode: DiffLayoutMode) => {
    void persistSettingsPatch({ ui: { diffLayout: mode } });
  };

  const diffProps = {
    hunks,
    variant,
    ...(maxHeightClass ? { maxHeightClass } : {}),
    ...(linePick ? { linePick } : {})
  };

  const body =
    layout === 'split' ? (
      <SplitDiffViewer {...diffProps} />
    ) : (
      <UnifiedDiffBody {...diffProps} />
    );

  const showToggle = showLayoutToggle && variant !== 'partial';
  if (!showToggle) return body;

  return (
    <div className="flex flex-col">
      <div className="mb-1.5 flex justify-end">
        <DiffLayoutToggle value={layout} onChange={onLayoutChange} />
      </div>
      {body}
    </div>
  );
}
