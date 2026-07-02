/**
 * MemoryPanel — surface for browsing and editing Agent V's persistent
 * memory. Renders inside Settings → Agent behavior → Memory.
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, RefreshCcw, Save, FilePlus2, FolderOpen } from 'lucide-react';
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
import { formatTimestamp } from '../../lib/formatTimestamp.js';
import { useToastStore } from '../../store/useToastStore.js';
import {
  ShellCaption,
  ShellFieldLabel,
  ShellRow,
  ShellSection
} from '../ui/ShellSection.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

type Scope = 'global' | 'workspace';
type ViewMode = 'edit' | 'preview';

const SCOPE_TABS: TabItem<Scope>[] = [
  { id: 'global', label: 'Global' },
  { id: 'workspace', label: 'Workspace' }
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

export function MemoryPanel() {
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
  const [editorOpen, setEditorOpen] = useState(false);

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

  useEffect(() => {
    setEditorOpen(false);
  }, [scope, activeKey]);

  useEffect(() => {
    if (draft?.dirty) setEditorOpen(true);
  }, [draft?.dirty]);

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
    const displayKey = key.endsWith('.md') ? key.slice(0, -3) : key;
    await refresh(displayKey);
  };

  const onAppendGlobal = async () => {
    const line = appendDraft.trim();
    if (!line) return;
    try {
      await vyotiq.memory.write('global', 'meta-rules.md', line, 'append');
      setAppendDraft('');
      await refresh('meta-rules.md');
      showToast('Appended to meta-rules.md', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Append failed: ${msg}`, 'danger');
    }
  };

  const onAppendWorkspace = async () => {
    if (!draft) return;
    const line = appendDraft.trim();
    if (!line) return;
    try {
      await vyotiq.memory.write(
        'workspace',
        draft.key,
        line,
        'append',
        conversationId ?? undefined
      );
      setAppendDraft('');
      await refresh(draft.key);
      showToast(`Appended to ${draft.key}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Append failed: ${msg}`, 'danger');
    }
  };

  const onReveal = async () => {
    if (!draft) return;
    try {
      await vyotiq.memory.reveal(scope, draft.key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reveal file.';
      showToast(msg, 'danger');
    }
  };

  const activeEntry = draft ? list.find((e) => e.key === draft.key) : undefined;

  return (
    <ShellSection>
      <ShellCaption>
        Notes are read each turn. Global{' '}
        <span className="font-mono text-text-secondary">meta-rules.md</span> · workspace{' '}
        <span className="font-mono text-text-secondary">.vyotiq/memory/</span>.
      </ShellCaption>

      <ShellRow className="py-0">
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
          <Tabs<Scope>
            items={SCOPE_TABS}
            value={scope}
            onChange={setScope}
            variant="segmented"
            size="md"
            ariaLabel="Memory scope"
            className="min-w-0 flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh(activeKey ?? undefined)}
            disabled={loading}
            title="Reload list and content"
          >
            <RefreshCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            Refresh
          </Button>
        </div>
      </ShellRow>

      {isWorkspaceScope && !workspaceReady ? (
        <div className="vx-settings-empty w-full text-row text-text-muted">
          Pick a workspace to edit notes under{' '}
          <span className="font-mono">.vyotiq/memory/</span>.
        </div>
      ) : (
        <div className="vx-settings-memory">
          <div className="vx-memory-split">
            {scope === 'workspace' && (
              <ul
                className="vx-settings-memory-list scrollbar-stealth"
                aria-label="Workspace notes"
              >
                {loading && (
                  <li className="px-2 py-1.5">
                    <LoadingHint message="Loading notes…" size={12} />
                  </li>
                )}
                {!loading && list.length === 0 && (
                  <li className="px-2 py-2 text-row text-text-muted">
                    No notes yet — use New note below to add workspace memory.
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

            <div className="surface-shell vx-settings-memory-editor scrollbar-stealth">
              {draft ? (
                <>
                  {!editorOpen ? (
                    <div className="vx-settings-memory-collapsed">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-row text-text-secondary">
                          {draft.key}
                        </div>
                        {draft.dirty && (
                          <span className="text-row text-warning">Unsaved changes</span>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditorOpen(true)}
                      >
                        <ChevronDown
                          className={SHELL_ROW_ICON_CLASS}
                          strokeWidth={SHELL_ROW_ICON_STROKE}
                        />
                        Open editor
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="vx-settings-memory-toolbar">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-row text-text-secondary">
                            {draft.key}
                          </div>
                          {activeEntry?.lastReferencedAt != null && (
                            <span className="truncate text-meta text-text-faint">
                              Last in chat:{' '}
                              {activeEntry.lastReferencedConversationTitle ?? 'Chat'} ·{' '}
                              {formatTimestamp(activeEntry.lastReferencedAt)}
                            </span>
                          )}
                        </div>
                        <div className="vx-settings-memory-toolbar-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditorOpen(false)}
                            title="Collapse editor"
                          >
                            <ChevronUp
                              className={SHELL_ROW_ICON_CLASS}
                              strokeWidth={SHELL_ROW_ICON_STROKE}
                            />
                          </Button>
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
                            size="sm"
                            onClick={() => void onReveal()}
                            title="Reveal in file manager"
                          >
                            <FolderOpen
                              className={SHELL_ROW_ICON_CLASS}
                              strokeWidth={SHELL_ROW_ICON_STROKE}
                            />
                            Reveal
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={!draft.dirty}
                            onClick={() => void onSave()}
                          >
                            <Save
                              className={SHELL_ROW_ICON_CLASS}
                              strokeWidth={SHELL_ROW_ICON_STROKE}
                            />
                            Save
                          </Button>
                        </div>
                      </div>
                      {viewMode === 'edit' ? (
                        <textarea
                          aria-label="Note content"
                          value={draft.content}
                          onChange={(e) =>
                            setDraft((d) =>
                              d ? { ...d, content: e.target.value, dirty: true } : d
                            )
                          }
                          spellCheck={false}
                          rows={8}
                          className="vx-textarea"
                        />
                      ) : (
                        <div className="scrollbar-stealth vx-textarea min-h-[9rem] overflow-y-auto">
                          {draft.content.trim().length === 0 ? (
                            <div className="vx-caption italic">
                              Empty note. Switch to Edit to add content.
                            </div>
                          ) : (
                            <MarkdownBody text={draft.content} />
                          )}
                        </div>
                      )}
                      {scope === 'workspace' && (
                        <ShellRow className="border-t border-panel-edge/40 pt-3">
                          <ShellFieldLabel>Append to note</ShellFieldLabel>
                          <div className="vx-settings-append-row mt-1">
                            <TextField
                              value={appendDraft}
                              onChange={(e) => setAppendDraft(e.target.value)}
                              placeholder='e.g. "User prefers pnpm over npm."'
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={appendDraft.trim().length === 0}
                              onClick={() => void onAppendWorkspace()}
                            >
                              <Plus
                                className={SHELL_ROW_ICON_CLASS}
                                strokeWidth={SHELL_ROW_ICON_STROKE}
                              />
                              Append
                            </Button>
                          </div>
                        </ShellRow>
                      )}
                      {scope === 'global' && (
                        <ShellRow className="border-t border-panel-edge/40 pt-3">
                          <ShellFieldLabel>Append rule</ShellFieldLabel>
                          <div className="vx-settings-append-row mt-1">
                            <TextField
                              value={appendDraft}
                              onChange={(e) => setAppendDraft(e.target.value)}
                              placeholder='e.g. "Prefer TypeScript over JavaScript."'
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={appendDraft.trim().length === 0}
                              onClick={() => void onAppendGlobal()}
                            >
                              <Plus
                                className={SHELL_ROW_ICON_CLASS}
                                strokeWidth={SHELL_ROW_ICON_STROKE}
                              />
                              Append
                            </Button>
                          </div>
                        </ShellRow>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="text-row text-text-muted py-2">
                  {loading || contentLoading
                    ? 'Loading…'
                    : scope === 'global'
                      ? 'Loading meta-rules…'
                      : 'Select a note above.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

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
    </ShellSection>
  );
}
