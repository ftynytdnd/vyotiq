/**
 * MemoryPanel — surface for browsing and editing Agent V's persistent
 * memory. Renders inside the Settings → Memory tab. Uses ONLY existing
 * tokens / primitives (Button, Spinner, surface colors). No new design.
 *
 * Two scopes:
 *   - global: a single `meta-rules.md` file under <userData>. The textarea
 *     is the full file. Save = full overwrite. There is also an Append
 *     affordance that hits the same date-stamped append flow the agent
 *     uses internally (see globalMeta.appendGlobalMetaRule).
 *   - workspace: many `.md` notes under `<workspace>/.vyotiq/memory/`. The
 *     left column lists them; the right column shows the selected one with
 *     edit + save. Adding a new note is supported via the "+ New note" row.
 *
 * The IPC surface (`vyotiq.memory.list/read/write`) is already in place —
 * this component just calls into it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCcw, Save, FilePlus2, FolderOpen } from 'lucide-react';
import type { MemoryEntry } from '@shared/types/ipc.js';
import { vyotiq } from '../../lib/ipc.js';
import { Button } from '../ui/Button.js';
import { Spinner } from '../ui/Spinner.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { PromptDialog } from '../ui/PromptDialog.js';
import { TextField } from '../ui/TextField.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { MarkdownBody } from '../timeline/markdown/MarkdownBody.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { chromeSettingsCardClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

type Scope = 'global' | 'workspace';
type ViewMode = 'edit' | 'preview';

const SCOPE_TABS: TabItem<Scope>[] = [
  { id: 'global', label: 'Global meta-rules' },
  { id: 'workspace', label: 'Workspace notes' }
];

const VIEW_MODE_TABS: TabItem<ViewMode>[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'preview', label: 'Preview' }
];

interface DraftState {
  key: string;
  content: string;
  dirty: boolean;
}

export function MemoryPanel({ layout = 'split' }: { layout?: 'split' | 'stack' }) {
  const ws = useWorkspaceStore((s) => s.info);
  const showToast = useToastStore((s) => s.show);
  const [scope, setScope] = useState<Scope>('global');
  const [list, setList] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [appendDraft, setAppendDraft] = useState('');
  const [pendingSelectKey, setPendingSelectKey] = useState<string | null>(null);
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');

  const workspaceReady = !!ws.path;
  const isWorkspaceScope = scope === 'workspace';

  const loadEntry = useCallback(async (key: string) => {
    setContentLoading(true);
    try {
      const entry = await vyotiq.memory.read(scope, key);
      if (!entry) {
        setDraft(null);
        return;
      }
      setDraft({ key: entry.key, content: entry.content, dirty: false });
    } finally {
      setContentLoading(false);
    }
  }, [scope]);

  const refresh = useCallback(
    async (preserveKey?: string) => {
      if (isWorkspaceScope && !workspaceReady) {
        setList([]);
        setActiveKey(null);
        setDraft(null);
        return;
      }
      setLoading(true);
      try {
        const entries = await vyotiq.memory.list(
          scope,
          isWorkspaceScope ? { keysOnly: true } : undefined
        );
        setList(entries);
        const next = preserveKey ?? entries[0]?.key ?? null;
        setActiveKey(next);
        if (next) {
          await loadEntry(next);
        } else {
          setDraft(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [scope, isWorkspaceScope, workspaceReady, loadEntry]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSelect = (key: string) => {
    if (draft?.dirty) {
      setPendingSelectKey(key);
      return;
    }
    setActiveKey(key);
    void loadEntry(key);
  };

  const confirmSelect = () => {
    const key = pendingSelectKey;
    setPendingSelectKey(null);
    if (!key) return;
    setActiveKey(key);
    void loadEntry(key);
  };

  const onSave = async () => {
    if (!draft) return;
    try {
      await vyotiq.memory.write(scope, draft.key, draft.content);
      await refresh(draft.key);
      showToast(`Saved ${draft.key}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Save failed: ${msg}`, 'danger');
    }
  };

  const onCreateNote = async (rawKey: string) => {
    setNewNoteOpen(false);
    const key = rawKey.trim();
    if (!key) return;
    const seed = `# ${key}\n\n`;
    await vyotiq.memory.write('workspace', key, seed);
    // List entries now return the topic-only key (no `.md` suffix) —
    // strip the extension the user may have typed so the selection
    // matches the sanitized backend key. See
    // `workspaceNotes.publicKey` for the storage-vs-display split.
    const displayKey = key.endsWith('.md') ? key.slice(0, -3) : key;
    await refresh(displayKey);
  };

  const onAppendGlobal = async () => {
    const line = appendDraft.trim();
    if (!line) return;
    try {
      // F-022: previously `vyotiq.memory.write('global', 'append', line)`,
      // where `'append'` was a magic key sentinel. The new wire shape uses
      // `mode: 'append'` and the real entry key.
      await vyotiq.memory.write('global', 'meta-rules.md', line, 'append');
      setAppendDraft('');
      await refresh('meta-rules.md');
      showToast('Appended to meta-rules.md', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Append failed: ${msg}`, 'danger');
    }
  };

  /**
   * Reveal the selected entry's underlying file in the OS file
   * manager. IPC errors (e.g. no workspace bound for workspace-scoped
   * notes) surface through the shared `useToastStore` so the user
   * gets a uniform feedback surface with the rest of the app.
   */
  const onReveal = async () => {
    if (!draft) return;
    try {
      await vyotiq.memory.reveal(scope, draft.key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reveal file.';
      showToast(msg, 'danger');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Tabs<Scope>
          items={SCOPE_TABS}
          value={scope}
          onChange={setScope}
          variant="strip"
          ariaLabel="Memory scope"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void refresh(activeKey ?? undefined)} disabled={loading}>
            <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2.25} />
            Refresh
          </Button>
        </div>
      </div>

      {isWorkspaceScope && !workspaceReady ? (
        <div
          className={cn(
            chromeSettingsCardClassName,
            'px-4 py-6 text-center text-row text-text-muted'
          )}
        >
          Pick a workspace first. Workspace notes live inside <span className="font-mono">.vyotiq/memory/</span>.
        </div>
      ) : (
        <div
          className={cn(
            'gap-3',
            layout === 'stack' ? 'flex flex-col' : 'grid grid-cols-[180px_1fr]'
          )}
        >
          <div
            className={cn(
              'flex flex-col gap-1 overflow-y-auto p-2',
              chromeSettingsCardClassName,
              layout === 'stack' ? 'max-h-36' : 'max-h-[420px]'
            )}
          >
            {loading && (
              <div className="flex items-center gap-2 px-2 py-1 text-row text-text-muted">
                <Spinner /> Loading…
              </div>
            )}
            {!loading && list.length === 0 && (
              <div className="px-2 py-1 text-row text-text-muted">
                {scope === 'global' ? 'No meta-rules yet.' : 'No notes yet.'}
              </div>
            )}
            {list.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => onSelect(entry.key)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 rounded-inner px-2 py-1.5 text-left text-row transition-colors duration-150',
                  entry.key === activeKey
                    ? 'bg-surface-hover text-text-primary'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
                )}
              >
                <span className="truncate font-mono">{entry.key}</span>
                <span className="text-meta text-text-faint">
                  {new Date(entry.updatedAt).toLocaleString()}
                </span>
              </button>
            ))}
            {scope === 'workspace' && (
              <button
                type="button"
                onClick={() => setNewNoteOpen(true)}
                className={cn(
                  'mt-1 inline-flex items-center gap-1.5 rounded-inner px-2 py-1.5 text-row',
                  'text-text-muted transition-colors duration-150',
                  'hover:bg-surface-hover hover:text-text-primary'
                )}
              >
                <FilePlus2 className="h-3.5 w-3.5" strokeWidth={2.25} />
                New note
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {draft ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-mono text-row text-text-secondary">
                    {draft.key}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tabs<ViewMode>
                      items={VIEW_MODE_TABS}
                      value={viewMode}
                      onChange={setViewMode}
                      variant="segmented"
                      size="sm"
                      ariaLabel="Note view mode"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void onReveal()}
                      title="Reveal in file manager"
                    >
                      <FolderOpen className="h-3.5 w-3.5" strokeWidth={2.25} />
                      Reveal
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!draft.dirty}
                      onClick={() => void onSave()}
                    >
                      <Save className="h-3.5 w-3.5" strokeWidth={2.25} />
                      Save
                    </Button>
                  </div>
                </div>
                {viewMode === 'edit' ? (
                  <textarea
                    value={draft.content}
                    onChange={(e) =>
                      setDraft((d) => (d ? { ...d, content: e.target.value, dirty: true } : d))
                    }
                    spellCheck={false}
                    className={cn(
                      'w-full resize-none rounded-inner bg-surface-base p-3',
                      'font-mono text-row leading-relaxed text-text-primary',
                      'outline-none focus:outline-none',
                      layout === 'stack' ? 'h-[240px]' : 'h-[360px]'
                    )}
                  />
                ) : (
                  <div
                    className={cn(
                      'scrollbar-stealth w-full overflow-y-auto rounded-inner bg-surface-base p-3',
                      layout === 'stack' ? 'h-[240px]' : 'h-[360px]'
                    )}
                  >
                    {draft.content.trim().length === 0 ? (
                      <div className="text-row italic text-text-faint">
                        Empty note. Switch to Edit to add content.
                      </div>
                    ) : (
                      <MarkdownBody text={draft.content} />
                    )}
                  </div>
                )}
                {scope === 'global' && (
                  <div className={cn(chromeSettingsCardClassName, 'flex flex-col gap-1.5 p-3')}>
                    <Eyebrow as="span" size="row">
                      Append a new rule (date-stamped)
                    </Eyebrow>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <TextField
                        className="min-w-0 flex-1"
                        value={appendDraft}
                        onChange={(e) => setAppendDraft(e.target.value)}
                        placeholder='e.g. "Prefer TypeScript over JavaScript."'
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={appendDraft.trim().length === 0}
                        onClick={() => void onAppendGlobal()}
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
                        Append
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div
          className={cn(
            chromeSettingsCardClassName,
            'px-4 py-6 text-center text-row text-text-muted'
          )}
        >
                {loading || contentLoading ? 'Loading…' : 'Select an entry above.'}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="text-row text-text-faint">
        Agent V reads relevant notes automatically at the start of each turn and may append to
        meta-rules when you issue persistent corrections.
      </div>

      <ConfirmDialog
        open={pendingSelectKey !== null}
        title="Discard unsaved changes?"
        message="You have unsaved edits in the current note. Switching will discard them."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={confirmSelect}
        onCancel={() => setPendingSelectKey(null)}
      />

      <PromptDialog
        open={newNoteOpen}
        title="New workspace note"
        message='Enter a key for the new note (e.g. "project-structure"). The key becomes the filename inside .vyotiq/memory/.'
        placeholder="project-structure"
        confirmLabel="Create"
        validate={(v) =>
          v.length === 0
            ? 'Key cannot be empty.'
            : /^[a-zA-Z0-9._-]+$/.test(v)
              ? null
              : 'Use letters, numbers, dots, dashes, or underscores only.'
        }
        onSubmit={(v) => void onCreateNote(v)}
        onCancel={() => setNewNoteOpen(false)}
      />
    </div>
  );
}

