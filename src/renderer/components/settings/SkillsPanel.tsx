/**
 * Settings → Agent behavior → Skills — browse discovered Agent Skills.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, Plus, RefreshCcw, Copy, MessageSquare } from 'lucide-react';
import type { SkillMeta, SkillSource } from '@shared/types/skills.js';
import { SKILL_SOURCE_LABELS } from '@shared/types/skills.js';
import { WORKSPACE_DOTDIR } from '@shared/constants.js';
import { vyotiq } from '../../lib/ipc.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { PromptDialog } from '../ui/PromptDialog.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { ShellCaption, ShellRow, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { openWorkspaceFileInEditor } from '../../lib/openWorkspaceFileInEditor.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { formatAuthoringModelHint } from '../../lib/authoringModelHint.js';
import { useDockFileTreeRefreshStore } from '../../store/useDockFileTreeRefreshStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { focusComposer } from '../../lib/focusComposer.js';
import { safeCopy } from '../../lib/clipboard.js';
import { useRequestAuthoringModelForEdit } from './useRequestAuthoringModelForEdit.js';
import { BundledSkillEditor } from './BundledSkillEditor.js';

type ScopeFilter = 'all' | SkillSource;

const SCOPE_TABS: TabItem<ScopeFilter>[] = [
  { id: 'all', label: 'All' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'global', label: 'Global' },
  { id: 'bundled', label: 'Built-in' }
];

function workspaceRelativeSkillPath(meta: SkillMeta, workspaceRoot: string): string | null {
  if (meta.source === 'bundled') return null;
  const normRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
  const normPath = meta.skillMdPath.replace(/\\/g, '/');
  if (!normPath.startsWith(normRoot + '/')) return null;
  return normPath.slice(normRoot.length + 1);
}

export function SkillsPanel() {
  useRequestAuthoringModelForEdit();
  const authoringModel = useSettingsStore((s) => s.settings.authoringModel);
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const workspacePath = useWorkspaceStore((s) => s.info.path);
  const showToast = useToastStore((s) => s.show);
  const treeRefreshVersion = useDockFileTreeRefreshStore((s) => s.version);
  const conversationId = useChatStore((s) => s.conversationId);
  const setDraft = useChatStore((s) => s.setDraft);
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [customizeMeta, setCustomizeMeta] = useState<SkillMeta | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setSkills([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await vyotiq.skills.list(workspaceId);
      setSkills(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not load skills: ${msg}`, 'danger');
    } finally {
      setLoading(false);
    }
  }, [showToast, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh, treeRefreshVersion]);

  const filtered = useMemo(() => {
    if (scope === 'all') return skills;
    if (scope === 'global') {
      return skills.filter((s) => s.source === 'global' || s.source === 'cursor-global');
    }
    if (scope === 'workspace') {
      return skills.filter((s) => s.source === 'workspace' || s.source === 'cursor-project');
    }
    return skills.filter((s) => s.source === scope);
  }, [scope, skills]);

  const onCreate = async (name: string) => {
    if (!workspaceId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await vyotiq.skills.create(workspaceId, trimmed);
      setCreateOpen(false);
      setNewName('');
      await refresh();
      showToast(`Created skill "${trimmed}" under ${WORKSPACE_DOTDIR}/skills/`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not create skill: ${msg}`, 'danger');
    }
  };

  const onOpen = async (meta: SkillMeta) => {
    if (!workspacePath || !workspaceId) return;
    const rel = workspaceRelativeSkillPath(meta, workspacePath);
    if (!rel) {
      setCustomizeMeta(meta);
      return;
    }
    try {
      await openWorkspaceFileInEditor(rel, { workspaceId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not open skill: ${msg}`, 'danger');
    }
  };

  const onReveal = async (meta: SkillMeta) => {
    if (!workspaceId) return;
    try {
      await vyotiq.skills.reveal(workspaceId, meta.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not reveal skill: ${msg}`, 'danger');
    }
  };

  const onInvoke = (name: string) => {
    if (conversationId) {
      setDraft(conversationId, `/${name} `);
    }
    focusComposer();
    showToast(`Composer ready — /${name}`, 'info');
  };

  const onCopySlash = async (name: string) => {
    const ok = await safeCopy(`/${name}`);
    showToast(ok ? `Copied /${name}` : 'Could not copy', ok ? 'success' : 'danger');
  };

  return (
    <ShellStack>
      <ShellSection title="Agent skills" variant="flat">
        <ShellCaption>
          Skills are SKILL.md workflows loaded on demand via the <code>context</code> tool.
          Create workspace skills under <code>{WORKSPACE_DOTDIR}/skills/&lt;name&gt;/SKILL.md</code> or
          invoke with <code>/skill-name</code> in the composer.
        </ShellCaption>
        {authoringModel ? (
          <ShellCaption>{formatAuthoringModelHint(authoringModel)}</ShellCaption>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Tabs items={SCOPE_TABS} value={scope} onChange={setScope} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || !workspaceId}
          >
            <RefreshCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            Refresh
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={!workspaceId}
          >
            <Plus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            New skill
          </Button>
        </div>
      </ShellSection>

      {!workspaceId ? (
        <ShellCaption>Select a workspace to browse skills.</ShellCaption>
      ) : loading ? (
        <LoadingHint message="Loading skills…" className="py-2" />
      ) : filtered.length === 0 ? (
        <ShellCaption>No skills in this filter. Create one or add SKILL.md under skill directories.</ShellCaption>
      ) : (
        <ShellSection title="Discovered" variant="flat">
          <ul className="vx-stack gap-1">
            {filtered.map((meta) => (
              <li key={`${meta.source}:${meta.name}`}>
                <ShellRow className="items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-text-primary">{meta.name}</span>
                      {meta.disableModelInvocation ? (
                        <span className="rounded px-1 py-0.5 text-meta uppercase tracking-wide text-text-muted bg-surface-raised">
                          Manual only
                        </span>
                      ) : null}
                    </div>
                    <div className="text-meta text-text-muted mt-0.5 line-clamp-2">
                      {meta.description}
                    </div>
                    <div className="text-meta text-text-muted mt-1">
                      {SKILL_SOURCE_LABELS[meta.source]}
                      {meta.scopeHint ? ` · ${meta.scopeHint}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onInvoke(meta.name)}
                      title={`Invoke /${meta.name} in composer`}
                    >
                      <MessageSquare
                        className={SHELL_ROW_ICON_CLASS}
                        strokeWidth={SHELL_ROW_ICON_STROKE}
                      />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void onCopySlash(meta.name)}
                      aria-label={`Copy /${meta.name}`}
                    >
                      <Copy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void onOpen(meta)}>
                      {meta.source === 'bundled' ? 'Customize' : 'Open'}
                    </Button>
                    {meta.source !== 'bundled' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void onReveal(meta)}
                        aria-label={`Reveal ${meta.name}`}
                      >
                        <FolderOpen
                          className={SHELL_ROW_ICON_CLASS}
                          strokeWidth={SHELL_ROW_ICON_STROKE}
                        />
                      </Button>
                    ) : null}
                  </div>
                </ShellRow>
              </li>
            ))}
          </ul>
        </ShellSection>
      )}

      {customizeMeta && workspaceId ? (
        <BundledSkillEditor
          workspaceId={workspaceId}
          meta={customizeMeta}
          onClose={() => setCustomizeMeta(null)}
        />
      ) : null}

      <PromptDialog
        open={createOpen}
        elevated
        title="New skill"
        message={`Creates ${WORKSPACE_DOTDIR}/skills/<name>/SKILL.md in the active workspace.`}
        placeholder="my-workflow"
        confirmLabel="Create"
        initialValue={newName}
        onSubmit={(value) => {
          void onCreate(value);
        }}
        onCancel={() => {
          setCreateOpen(false);
          setNewName('');
        }}
      />
    </ShellStack>
  );
}
