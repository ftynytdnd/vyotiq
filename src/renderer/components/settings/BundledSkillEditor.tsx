/**
 * Editor for built-in skill overrides (userData skill-overrides/*.md).
 */

import { useCallback, useEffect, useState } from 'react';
import type { SkillMeta } from '@shared/types/skills.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { ShellCaption, ShellRow, ShellSection, ShellStack } from '../ui/ShellSection.js';

interface BundledSkillEditorProps {
  workspaceId: string;
  meta: SkillMeta;
  onClose: () => void;
}

export function BundledSkillEditor({ workspaceId, meta, onClose }: BundledSkillEditorProps) {
  const showToast = useToastStore((s) => s.show);
  const [draft, setDraft] = useState('');
  const [bundled, setBundled] = useState('');
  const [hasOverride, setHasOverride] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await vyotiq.skills.read(workspaceId, meta.name);
      setDraft(row.effective);
      setBundled(row.raw);
      setHasOverride(row.effective.trim() !== row.raw.trim());
      setDirty(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not load skill: ${msg}`, 'danger');
    } finally {
      setLoading(false);
    }
  }, [meta.name, showToast, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    setBusy(true);
    try {
      await vyotiq.skills.writeOverride(workspaceId, meta.name, draft);
      showToast(`Saved override for ${meta.name}`, 'success');
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not save skill override: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    setBusy(true);
    try {
      await vyotiq.skills.resetOverride(workspaceId, meta.name);
      showToast(`Reset ${meta.name} to bundled default`, 'success');
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not reset skill: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ShellSection title={`Customize ${meta.name}`} variant="flat">
      <ShellStack>
        <ShellCaption>
          Overrides persist under userData and apply on the next agent run. Bundled default ships
          with the app.
        </ShellCaption>
        {loading ? (
          <LoadingHint message="Loading skill…" className="py-2" />
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
            aria-label={`Skill override ${meta.name}`}
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
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty || busy || loading}
            onClick={() => {
              setDraft(bundled);
              setDirty(false);
            }}
          >
            Revert edits
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </ShellRow>
        {!loading ? (
          <ShellCaption>
            {hasOverride ? 'Custom override active' : 'Bundled default'}
          </ShellCaption>
        ) : null}
      </ShellStack>
    </ShellSection>
  );
}
