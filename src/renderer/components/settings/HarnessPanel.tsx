/**
 * Settings → Agent behavior → Harness — edit natural-language OS sections.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HarnessSectionId, HarnessSectionInfo } from '@shared/types/harness.js';
import { HARNESS_SECTION_IDS } from '@shared/types/harness.js';
import { vyotiq } from '../../lib/ipc.js';
import { ShellCaption, ShellRow, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';

const SECTION_LABELS: Record<HarnessSectionId, string> = {
  'orchestrator-core': 'Agent core',
  'context-learning': 'Context & learning',
  deliverables: 'Deliverables',
  'static-examples': 'Static examples (few-shot)'
};

export function HarnessPanel() {
  const [sections, setSections] = useState<HarnessSectionInfo[]>([]);
  const [activeId, setActiveId] = useState<HarnessSectionId>('orchestrator-core');
  const [draft, setDraft] = useState('');
  const [bundled, setBundled] = useState('');
  const [hasOverride, setHasOverride] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refreshSections = useCallback(async () => {
    const rows = await vyotiq.harness.listSections();
    setSections(rows);
  }, []);

  const loadSection = useCallback(async (sectionId: HarnessSectionId) => {
    setLoading(true);
    try {
      const row = await vyotiq.harness.readSection(sectionId);
      setDraft(row.effective);
      setBundled(row.bundled);
      setHasOverride(row.override !== null);
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSections();
  }, [refreshSections]);

  useEffect(() => {
    void loadSection(activeId);
  }, [activeId, loadSection]);

  const onSave = async () => {
    setBusy(true);
    try {
      await vyotiq.harness.writeSection(activeId, draft);
      await refreshSections();
      await loadSection(activeId);
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    setBusy(true);
    try {
      await vyotiq.harness.resetSection(activeId);
      await refreshSections();
      await loadSection(activeId);
    } finally {
      setBusy(false);
    }
  };

  const onRevertDraft = () => {
    setDraft(bundled);
    setDirty(false);
  };

  const activeMeta = sections.find((s) => s.id === activeId);

  return (
    <ShellSection title="Harness">
      <ShellStack>
        <ShellCaption>
          Edit Agent V natural-language instructions. Overrides persist under userData and apply on
          the next run without rebuilding the app.
        </ShellCaption>

        <ShellRow className="flex flex-wrap gap-1.5">
          {HARNESS_SECTION_IDS.map((id) => {
            const meta = sections.find((s) => s.id === id);
            const selected = id === activeId;
            return (
              <Button
                key={id}
                variant={selected ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setActiveId(id)}
                title={meta?.file ?? SECTION_LABELS[id]}
              >
                {SECTION_LABELS[id]}
                {meta?.hasOverride ? ' *' : ''}
              </Button>
            );
          })}
        </ShellRow>

        {activeMeta && (
          <ShellCaption>
            {activeMeta.file}
            {hasOverride ? ' · custom override active' : ' · bundled default'}
          </ShellCaption>
        )}

        {loading ? (
          <LoadingHint message="Loading harness…" className="py-2" />
        ) : (
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            rows={16}
            className="vx-textarea font-mono text-[12px] leading-relaxed"
            aria-label={`Harness section ${SECTION_LABELS[activeId]}`}
          />
        )}

        <ShellRow className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={!dirty || busy || loading} onClick={() => void onSave()}>
            Save override
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasOverride || busy || loading}
            onClick={() => void onReset()}
          >
            Reset to bundled
          </Button>
          <Button variant="ghost" size="sm" disabled={!dirty || busy || loading} onClick={onRevertDraft}>
            Revert edits
          </Button>
        </ShellRow>
      </ShellStack>
    </ShellSection>
  );
}
