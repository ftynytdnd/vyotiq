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
import { LoadingHint } from '../ui/LoadingHint.js';
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import { PromptDialog } from '../ui/PromptDialog.js';
import { TextField } from '../ui/TextField.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { MarkdownBody } from '../timeline/markdown/MarkdownBody.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { formatTimestamp } from '../checkpoints/formatTimestamp.js';
import { useToastStore } from '../../store/useToastStore.js';
import {
  ShellCaption,
  ShellFieldActions,
  ShellFieldLabel,
  ShellRow,
  ShellSection,
  ShellStack
} from '../ui/ShellSection.js';
import { chromeListEmptyBodyClassName, chromeListEmptyClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

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
  const conversationId = useChatStore((s) => s.conversationId);
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
      await vyotiq.memory.write(
        scope,
        draft.key,
        draft.content,
        undefined,
        scope === 'workspace' ? conversationId ?? undefined : undefined
      );
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
    await vyotiq.memory.write(
      'workspace',
      key,
      seed,
      undefined,
      conversationId ?? undefined
    );
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
    <ShellStack>
      <ShellSection title="Scope">
        <ShellRow>
          <ShellFieldLabel>Memory scope</ShellFieldLabel>
          <ShellCaption>Switch between global meta-rules and per-workspace notes.</ShellCaption>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Tabs<Scope>
              items={SCOPE_TABS}
              value={scope}
              onChange={setScope}
              variant="segmented"
              size="md"
              ariaLabel="Memory scope"
              className="min-w-0 flex-1"
            />
            <Button variant="ghost" onClick={() => void refresh(activeKey ?? undefined)} disabled={loading}>
              <RefreshCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
              Refresh
            </Button>
          </div>
        </ShellRow>
      </ShellSection>

      {isWorkspaceScope && !workspaceReady ? (
        <div className={chromeListEmptyClassName}>
          Pick a workspace first. Workspace notes live inside{' '}
          <span className="font-mono">.vyotiq/memory/</span>.
        </div>
      ) : (
        <ShellSection title={scope === 'global' ? 'meta-rules.md' : 'Workspace notes'}>
          <div className="vx-memory-split">
            {scope === 'workspace' && (
              <ul className="vx-memory-list" aria-label="Workspace notes">
                {loading && (
                  <li>
                    <div className="flex items-center gap-2 px-2 py-1 vx-caption">
                      <LoadingHint message="Loading…" className="py-2" />
                    </div>
                  </li>
                )}
                {!loading && list.length === 0 && (
                  <li>
                    <div className={cn(chromeListEmptyBodyClassName, 'px-2 text-left')}>
                      No notes yet.
                    </div>
                  </li>
                )}
                {list.map((entry) => (
                  <li key={entry.key}>
                    {pendingSelectKey === entry.key ? (
                      <DestructiveConfirm
                        variant="inline"
                        open
                        twoStep={false}
                        context={entry.key}
                        question="Discard unsaved edits?"
                        confirmLabel="Discard"
                        cancelLabel="Keep editing"
                        onConfirm={confirmSelect}
                        onCancel={() => setPendingSelectKey(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(entry.key)}
                        className="vx-memory-list-item flex flex-col items-start gap-0.5"
                        data-active={entry.key === activeKey ? 'true' : 'false'}
                      >
                        <span className="truncate w-full text-left">{entry.key}</span>
                        {entry.lastReferencedAt != null && (
                          <span className="truncate w-full text-left text-meta text-text-faint">
                            Last in chat: {entry.lastReferencedConversationTitle ?? 'Chat'} ·{' '}
                            {formatTimestamp(entry.lastReferencedAt)}
                          </span>
                        )}
                      </button>
                    )}
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setNewNoteOpen(true)}
                    className="vx-memory-list-item inline-flex items-center gap-1.5"
                  >
                    <FilePlus2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                    New note
                  </button>
                </li>
              </ul>
            )}

            <div className="vx-memory-editor">
              {draft ? (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <div className="truncate font-mono text-row text-text-secondary">
                        {draft.key}
                      </div>
                      {(list.find((e) => e.key === draft.key) ?? list[0])?.lastReferencedAt != null && (
                        <span className="truncate text-meta text-text-faint">
                          Last in chat:{' '}
                          {(list.find((e) => e.key === draft.key) ?? list[0])
                            ?.lastReferencedConversationTitle ?? 'Chat'}{' '}
                          ·{' '}
                          {formatTimestamp(
                            (list.find((e) => e.key === draft.key) ?? list[0])!.lastReferencedAt!
                          )}
                        </span>
                      )}
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
                        variant="ghost"
                        onClick={() => void onReveal()}
                        title="Reveal in file manager"
                      >
                        <FolderOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                        Reveal
                      </Button>
                      <Button variant="primary" disabled={!draft.dirty} onClick={() => void onSave()}>
                        <Save className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
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
                      rows={layout === 'stack' ? 10 : 14}
                      className={cn('vx-textarea', layout === 'stack' ? 'min-h-[240px]' : 'min-h-[360px]')}
                    />
                  ) : (
                    <div
                      className={cn(
                        'scrollbar-stealth vx-textarea overflow-y-auto',
                        layout === 'stack' ? 'min-h-[240px]' : 'min-h-[360px]'
                      )}
                    >
                      {draft.content.trim().length === 0 ? (
                        <div className="vx-caption italic">Empty note. Switch to Edit to add content.</div>
                      ) : (
                        <MarkdownBody text={draft.content} />
                      )}
                    </div>
                  )}
                  {scope === 'global' && (
                    <ShellRow>
                      <ShellFieldLabel>Append a new rule (date-stamped)</ShellFieldLabel>
                      <TextField
                        className="mt-1"
                        value={appendDraft}
                        onChange={(e) => setAppendDraft(e.target.value)}
                        placeholder='e.g. "Prefer TypeScript over JavaScript."'
                      />
                      <ShellFieldActions>
                        <Button
                          variant="secondary"
                          disabled={appendDraft.trim().length === 0}
                          onClick={() => void onAppendGlobal()}
                        >
                          <Plus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                          Append
                        </Button>
                      </ShellFieldActions>
                    </ShellRow>
                  )}
                </>
              ) : (
                <div className={cn(chromeListEmptyBodyClassName, 'px-2 text-left')}>
                  {loading || contentLoading
                    ? 'Loading…'
                    : scope === 'global'
                      ? 'Loading meta-rules…'
                      : 'Select an entry above.'}
                </div>
              )}
            </div>
          </div>
        </ShellSection>
      )}

      <ShellCaption>
        Agent V reads relevant notes automatically at the start of each turn and may append to
        meta-rules when you issue persistent corrections.
      </ShellCaption>

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
    </ShellStack>
  );
}
