/**
 * Settings → Agent behavior → Harness — edit natural-language OS sections.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HarnessSectionId, HarnessSectionInfo } from '@shared/types/harness.js';
import { CONTEXT_PACKS } from '@shared/types/harness.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import { ShellCaption, ShellRow, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { formatAuthoringModelHint } from '../../lib/authoringModelHint.js';
import { useRequestAuthoringModelForEdit } from './useRequestAuthoringModelForEdit.js';

const SECTION_LABELS: Record<HarnessSectionId, string> = {
  'orchestrator-core': 'Agent core',
  'context-learning': 'Context & learning',
  deliverables: 'Deliverables',
  'static-examples': 'Tool-use examples',
  'ast-grep-reference': 'ast-grep reference',
  'dynamic-loop': 'Dynamic agent loop'
};

/** Pack catalogue metadata, keyed by id for quick lookup in the panel. */
const PACK_META = new Map(CONTEXT_PACKS.map((p) => [p.id as HarnessSectionId, p]));

export function HarnessPanel() {
  useRequestAuthoringModelForEdit();
  const authoringModel = useSettingsStore((s) => s.settings.authoringModel);
  const [sections, setSections] = useState<HarnessSectionInfo[]>([]);
  const [activeId, setActiveId] = useState<HarnessSectionId>('orchestrator-core');
  const [draft, setDraft] = useState('');
  const [bundled, setBundled] = useState('');
  const [hasOverride, setHasOverride] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingSectionId, setPendingSectionId] = useState<HarnessSectionId | null>(null);

  const refreshSections = useCallback(async () => {
    try {
      const rows = await vyotiq.harness.listSections();
      setSections(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not load harness sections: ${msg}`, 'danger');
    }
  }, []);

  const loadSection = useCallback(async (sectionId: HarnessSectionId) => {
    setLoading(true);
    try {
      const row = await vyotiq.harness.readSection(sectionId);
      setDraft(row.effective);
      setBundled(row.bundled);
      setHasOverride(row.override !== null);
      setDirty(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not load harness section: ${msg}`, 'danger');
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

  const onSelectSection = (sectionId: HarnessSectionId) => {
    if (sectionId === activeId) return;
    if (dirty) {
      setPendingSectionId(sectionId);
      return;
    }
    setActiveId(sectionId);
  };

  const confirmSectionSwitch = () => {
    const next = pendingSectionId;
    setPendingSectionId(null);
    if (!next) return;
    setActiveId(next);
  };

  const onSave = async () => {
    setBusy(true);
    try {
      await vyotiq.harness.writeSection(activeId, draft);
      await refreshSections();
      await loadSection(activeId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not save harness section: ${msg}`, 'danger');
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not reset harness section: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const onRevertDraft = () => {
    setDraft(bundled);
    setDirty(false);
  };

  const activeMeta = sections.find((s) => s.id === activeId);
  const activePack = PACK_META.get(activeId);
  const prefixSections = sections.filter((s) => s.placement === 'prefix');
  const packSections = sections.filter((s) => s.placement === 'pack');

  const renderGroup = (label: string, group: HarnessSectionInfo[]) => {
    if (group.length === 0) return null;
    return (
      <ShellStack>
        <h4 className="vx-section-head">{label}</h4>
        <ShellRow className="flex flex-wrap gap-1.5">
          {group.map((meta) => {
            const selected = meta.id === activeId;
            return (
              <Button
                key={meta.id}
                variant={selected ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => onSelectSection(meta.id)}
                title={meta.file}
              >
                {SECTION_LABELS[meta.id]}
                {meta.hasOverride ? ' *' : ''}
              </Button>
            );
          })}
        </ShellRow>
      </ShellStack>
    );
  };

  return (
    <ShellSection>
      <ShellStack>
        <ShellCaption>
          Edit Agent V natural-language instructions. Always-on sections ship in every system
          prompt. On-demand reference workflows are **Agent Skills** — manage them in
          Settings → Agent behavior → Skills (loaded via the `context` tool). Overrides persist
          under userData and apply on the next run without rebuilding the app.
        </ShellCaption>
        {authoringModel ? (
          <ShellCaption>{formatAuthoringModelHint(authoringModel)}</ShellCaption>
        ) : null}

        {renderGroup('Always-on sections', prefixSections)}
        {packSections.length > 0 ? (
          <ShellCaption>
            Built-in reference skills (ast-grep, deliverables, examples) live under Agent
            behavior → Skills. Invoke with <code>context</code> load or <code>/skill-name</code>{' '}
            in the composer.
          </ShellCaption>
        ) : null}

        {activeMeta && (
          <ShellCaption>
            {activeMeta.file}
            {hasOverride ? ' · custom override active' : ' · bundled default'}
            {activeMeta.placement === 'pack' ? ' · on-demand (loaded via `context`)' : ''}
          </ShellCaption>
        )}
        {activePack && (
          <ShellCaption>Load when: {activePack.loadWhen}</ShellCaption>
        )}

        {loading ? (
          <LoadingHint message="Loading harness…" className="py-2" />
        ) : activeMeta?.placement === 'pack' ? (
          <ShellCaption>
            This section is now a built-in skill. Open Agent behavior → Skills to browse it,
            or edit legacy overrides via skill-overrides in userData.
          </ShellCaption>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            rows={16}
            className="vx-textarea font-mono text-chat-meta leading-relaxed"
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
        {pendingSectionId !== null ? (
          <DestructiveConfirm
            variant="inline"
            open
            twoStep={false}
            question="Discard unsaved harness edits?"
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            onConfirm={confirmSectionSwitch}
            onCancel={() => setPendingSectionId(null)}
          />
        ) : null}
      </ShellStack>
    </ShellSection>
  );
}
