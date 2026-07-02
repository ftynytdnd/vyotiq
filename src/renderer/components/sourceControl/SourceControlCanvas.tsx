/**
 * Source control companion canvas — split changes list + diff preview + commit dock.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { formatBranchSyncSuffix } from '@shared/github/formatBranchSync.js';
import { vyotiq } from '../../lib/ipc.js';
import { useWorkspaceGitStatus } from '../../hooks/useWorkspaceGitStatus.js';
import { useGitFileDiffPreview, useGitDiffPreviewRow } from '../../hooks/useGitFileDiffPreview.js';
import { useSourceControlStore } from '../../store/useSourceControlStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { resolveGitCommitMessageModel } from '@shared/git/resolveGitCommitMessageModel.js';
import { openWorkspaceFile } from '../../lib/openPath.js';
import { formatGitIpcError } from '../../lib/formatGitIpcError.js';
import { refreshWorkspaceGitStatusNow } from '../../lib/workspaceGitStatusHub.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE } from '../../lib/shellIcons.js';
import { WORKBENCH_BODY_CLASS } from '../workbench/workbenchShared.js';
import { WORKBENCH_EMPTY_CARD_CLASS } from '../workbench/workbenchChrome.js';
import { PromptDialog } from '../ui/PromptDialog.js';
import { SourceControlBranchPanel } from './SourceControlBranchPanel.js';
import { buildSourceControlRows, type SourceControlFileRow } from './sourceControlModel.js';
import { SourceControlToolbar } from './SourceControlToolbar.js';
import { SourceControlFileList, collectChangedFolderPaths } from './SourceControlFileList.js';
import { SourceControlDiffPane } from './SourceControlDiffPane.js';
import { SourceControlCommitDock } from './SourceControlCommitDock.js';
import { generateLiveCommitMessage } from './sourceControlCommitMessage.js';
import { formatCommitMessageModelLabel } from './sourceControlModelLabel.js';

function showGitError(err: unknown): void {
  useToastStore.getState().show(formatGitIpcError(err), 'danger');
}

function showGitSuccess(message: string): void {
  useToastStore.getState().show(message, 'success');
}

const GIT_SUCCESS_LABEL: Record<string, string> = {
  stage: 'Staged',
  unstage: 'Unstaged',
  discard: 'Discarded changes',
  commit: 'Committed',
  'commit-push': 'Committed and pushed',
  amend: 'Amended last commit',
  push: 'Pushed to remote',
  fetch: 'Fetched from remote',
  pull: 'Pulled from remote',
  generate: 'Generated commit message',
  'stage-all': 'Staged all changes',
  'unstage-all': 'Unstaged all changes',
  'discard-all': 'Discarded all changes',
  stash: 'Stashed changes',
  'stash-pop': 'Applied stash',
  checkout: 'Switched branch',
  'create-branch': 'Created branch'
};

export function SourceControlCanvas() {
  const workspaceId = useSourceControlStore((s) => s.workspaceId);
  const panelOpen = useSourceControlStore((s) => s.open);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspace = useWorkspaceStore((s) =>
    workspaceId ? s.list.find((w) => w.id === workspaceId) : undefined
  );
  const { staged, unstaged, context } = useWorkspaceGitStatus(workspaceId, Boolean(workspaceId));
  const providers = useProviderStore((s) => s.providers);
  const settings = useSettingsStore((s) => s.settings);
  const authoringModel = settings.authoringModel;
  const defaultModel = settings.defaultModel;
  const commitMessageModel = resolveGitCommitMessageModel(
    {
      providers,
      authoringModel,
      defaultModel,
      lastModelByWorkspace: settings.ui?.lastModelByWorkspace,
      autoModelByWorkspace: settings.ui?.autoModelByWorkspace
    },
    workspaceId
  );

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<SourceControlFileRow | null>(null);
  const previewRow = useGitDiffPreviewRow(selected);
  const selectedPreview = useGitFileDiffPreview(workspaceId, previewRow);
  const [commitMessage, setCommitMessage] = useState('');
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);
  const [messageGenerating, setMessageGenerating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [stashCount, setStashCount] = useState(0);
  const [discardTarget, setDiscardTarget] = useState<SourceControlFileRow | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([]);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const busyCountRef = useRef(0);

  useEffect(() => {
    if (!panelOpen || !activeWorkspaceId || !workspaceId) return;
    if (activeWorkspaceId !== workspaceId) {
      useSourceControlStore.getState().openPanel(activeWorkspaceId);
    }
  }, [panelOpen, activeWorkspaceId, workspaceId]);

  useEffect(() => {
    setCommitMessage('');
    setGenerateWarnings([]);
    setSelected(null);
    setBranchOpen(false);
    setBranches([]);
    setExpandedFolders(new Set());
    setDiscardAllOpen(false);
    setDiscardTarget(null);
    setNewBranchOpen(false);
    setStashCount(0);
  }, [workspaceId]);

  const { stagedRows, unstagedRows } = useMemo(
    () => buildSourceControlRows(staged, unstaged),
    [staged, unstaged]
  );

  const totalChanges = useMemo(() => {
    const paths = new Set<string>();
    for (const row of stagedRows) paths.add(row.path);
    for (const row of unstagedRows) paths.add(row.path);
    return paths.size;
  }, [stagedRows, unstagedRows]);
  const canGenerateMessage = Boolean(commitMessageModel) && totalChanges > 0;
  const generateDisabledTitle = !commitMessageModel
    ? 'Configure a provider model in Settings → Providers'
    : totalChanges === 0
      ? 'No changes to summarize'
      : 'Generate commit message with AI';
  const commitMessageModelLabel = commitMessageModel
    ? formatCommitMessageModelLabel(commitMessageModel, providers)
    : null;

  const generateMessageLive = useCallback(async (wsId: string) => {
    setMessageGenerating(true);
    setCommitMessage('');
    setGenerateWarnings([]);
    try {
      const result = await generateLiveCommitMessage(wsId, setCommitMessage);
      setGenerateWarnings(result.warnings);
      return result;
    } finally {
      setMessageGenerating(false);
    }
  }, []);

  const refreshStashCount = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const result = await vyotiq.workspace.gitStashList({ workspaceId });
      setStashCount(result.stashes.length);
    } catch {
      setStashCount(0);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshStashCount();
  }, [refreshStashCount, staged, unstaged]);

  const loadBranches = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const result = await vyotiq.workspace.gitBranches({ workspaceId });
      setBranches(result.branches.filter((b) => !b.remote));
    } catch (err) {
      showGitError(err);
      setBranches([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (branchOpen && !workspace?.github) void loadBranches();
  }, [branchOpen, loadBranches, workspace?.github]);

  useEffect(() => {
    const all = [...stagedRows, ...unstagedRows];
    if (all.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) =>
      prev && all.some((r) => r.path === prev.path && r.section === prev.section) ? prev : all[0]!
    );
  }, [stagedRows, unstagedRows]);

  useEffect(() => {
    if (!workspaceId) return;
    const all = [...stagedRows, ...unstagedRows];
    const folders = collectChangedFolderPaths(all, { collapseDeep: all.length > 24 });
    if (folders.size === 0) return;
    setExpandedFolders((prev) => (prev.size > 0 ? prev : folders));
  }, [workspaceId, stagedRows, unstagedRows]);

  const runGit = async (label: string, fn: () => Promise<void>) => {
    busyCountRef.current += 1;
    setBusy(label);
    try {
      await fn();
      if (workspaceId) refreshWorkspaceGitStatusNow(workspaceId);
      const successLabel = GIT_SUCCESS_LABEL[label];
      if (successLabel) showGitSuccess(successLabel);
    } catch (err) {
      showGitError(err);
    } finally {
      busyCountRef.current -= 1;
      if (busyCountRef.current <= 0) {
        busyCountRef.current = 0;
        setBusy(null);
      }
    }
  };

  const onStage = (row: SourceControlFileRow) =>
    runGit('stage', async () => {
      if (!workspaceId) return;
      await vyotiq.workspace.gitStage({ workspaceId, paths: [row.path] });
    });

  const onUnstage = (row: SourceControlFileRow) =>
    runGit('unstage', async () => {
      if (!workspaceId) return;
      await vyotiq.workspace.gitUnstage({ workspaceId, paths: [row.path] });
    });

  const onDiscard = (row: SourceControlFileRow) =>
    runGit('discard', async () => {
      if (!workspaceId) return;
      await vyotiq.workspace.gitDiscard({
        workspaceId,
        paths: [{ path: row.path, status: row.status }]
      });
    });

  const onPush = () =>
    runGit('push', async () => {
      if (!workspaceId) return;
      await vyotiq.workspace.gitPush({ workspaceId });
    });

  const onCommit = (andPush = false, amend = false) =>
    runGit(amend ? 'amend' : andPush ? 'commit-push' : 'commit', async () => {
      if (!workspaceId) throw new Error('No workspace selected.');
      let message = commitMessage.trim();
      if (!amend && !message) {
        if (!commitMessageModel) {
          throw new Error('Enter a commit message or configure a model in Settings → Providers.');
        }
        message = (await generateMessageLive(workspaceId)).message.trim();
        if (!message) throw new Error('Could not generate a commit message.');
      }
      await vyotiq.workspace.gitCommit({
        workspaceId,
        message,
        amend,
        stageAllIfEmpty: true
      });
      if (!amend) setCommitMessage('');
      if (andPush) await vyotiq.workspace.gitPush({ workspaceId });
    });

  const onGenerateMessage = () =>
    runGit('generate', async () => {
      if (!workspaceId) throw new Error('No workspace selected.');
      await generateMessageLive(workspaceId);
    });

  const branchLabel = context.branch ?? context.headShort ?? 'HEAD';
  const syncSuffix = formatBranchSyncSuffix(context.ahead, context.behind);
  const isRepo = context.isRepo;
  const canSync = isRepo && Boolean(context.remote);
  const syncDisabledTitle = canSync
    ? undefined
    : 'No git remote configured — add one with `git remote add <name> <url>`';
  const hasCommitMessage = Boolean(commitMessage.trim());
  const canCommitChanges = totalChanges > 0 && (hasCommitMessage || Boolean(commitMessageModel));
  const commitDisabledTitle =
    totalChanges === 0
      ? 'No changes to commit'
      : !hasCommitMessage && !commitMessageModel
        ? 'Enter a commit message or configure a model to generate one'
        : !hasCommitMessage
          ? 'Commit will generate a message from your changes'
          : 'Cannot commit';
  const canPush = canSync;
  const isBusy = busy !== null;
  const showFilePanels = totalChanges > 0;

  if (!workspaceId) {
    return (
      <div className={cn(WORKBENCH_BODY_CLASS, 'vx-sc-canvas items-center justify-center p-6')}>
        <div className={cn('max-w-sm space-y-2 text-center', WORKBENCH_EMPTY_CARD_CLASS)}>
          <GitBranch className="mx-auto size-8 text-text-faint" strokeWidth={SHELL_ACTION_ICON_STROKE} />
          <p className="text-section font-medium text-text-primary">Source control</p>
          <p className="text-row text-text-muted">Open a workspace to review and commit changes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(WORKBENCH_BODY_CLASS, 'vx-sc-canvas')} data-workbench-source-control aria-busy={isBusy}>
      <SourceControlToolbar
        branchLabel={branchLabel}
        syncSuffix={syncSuffix}
        context={context}
        totalChanges={totalChanges}
        busy={isBusy}
        branchOpen={branchOpen}
        onBranchToggle={() => setBranchOpen((o) => !o)}
        onRefresh={() => {
          if (workspaceId) refreshWorkspaceGitStatusNow(workspaceId);
        }}
        onFetch={() =>
          void runGit('fetch', async () => {
            await vyotiq.workspace.gitFetch({ workspaceId });
          })
        }
        onPull={() =>
          void runGit('pull', async () => {
            await vyotiq.workspace.gitPull({ workspaceId });
          })
        }
        onPush={() => void onPush()}
        syncDisabledTitle={syncDisabledTitle}
      />

      {branchOpen && workspaceId ? (
        <SourceControlBranchPanel
          workspaceId={workspaceId}
          branches={branches}
          githubBound={Boolean(workspace?.github)}
          onCheckout={(name) => {
            const current = branches.find((b) => b.current);
            if (current?.name === name) {
              showGitSuccess(`Already on ${name}`);
              return;
            }
            void runGit('checkout', async () => {
              await vyotiq.workspace.gitCheckout({ workspaceId, branch: name });
              setBranchOpen(false);
            });
          }}
          onCreateBranch={() => {
            setBranchOpen(false);
            setNewBranchOpen(true);
          }}
          onClose={() => setBranchOpen(false)}
        />
      ) : null}

      {!isRepo ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className={cn('max-w-sm space-y-2 text-center', WORKBENCH_EMPTY_CARD_CLASS)}>
            <p className="text-section font-medium text-text-primary">Not a git repository</p>
            <p className="text-row text-text-muted">Initialize git in this workspace to use source control.</p>
          </div>
        </div>
      ) : (
        <>
          <SourceControlCommitDock
            commitMessage={commitMessage}
            generateWarnings={generateWarnings}
            busy={isBusy}
            generateLoading={messageGenerating}
            commitLoading={busy === 'commit' || busy === 'commit-push' || busy === 'amend'}
            canGenerateMessage={canGenerateMessage}
            generateDisabledTitle={generateDisabledTitle}
            commitMessageModelLabel={commitMessageModelLabel}
            canSync={canSync}
            syncDisabledTitle={syncDisabledTitle}
            canCommit={canCommitChanges}
            commitDisabledTitle={commitDisabledTitle}
            canPush={canPush}
            canAmend={isRepo}
            hasUnstaged={unstagedRows.length > 0}
            hasChanges={totalChanges > 0}
            hasStash={stashCount > 0}
            onCommitMessageChange={setCommitMessage}
            onGenerate={() => void onGenerateMessage()}
            onCommit={() => void onCommit(false, false)}
            onCommitPush={() => void onCommit(true, false)}
            onPush={() => void onPush()}
            onAmend={() => void onCommit(false, true)}
            onStageAll={() =>
              void runGit('stage-all', async () => {
                await vyotiq.workspace.gitStage({ workspaceId, all: true });
              })
            }
            onDiscardAll={() => setDiscardAllOpen(true)}
            onStash={() =>
              void runGit('stash', async () => {
                await vyotiq.workspace.gitStash({ workspaceId, includeUntracked: true });
                await refreshStashCount();
              })
            }
            onStashPop={() =>
              void runGit('stash-pop', async () => {
                await vyotiq.workspace.gitStashPop({ workspaceId, index: 0 });
                await refreshStashCount();
              })
            }
          />

          <div className="vx-sc-body">
            {showFilePanels ? (
              <div className="vx-sc-split">
                <SourceControlFileList
                  className="vx-sc-split-list"
                  stagedRows={stagedRows}
                  unstagedRows={unstagedRows}
                  expandedFolders={expandedFolders}
                  selected={selected}
                  onFolderToggle={(path) =>
                    setExpandedFolders((prev) => {
                      const next = new Set(prev);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })
                  }
                  onSelect={setSelected}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  onDiscard={(row) => setDiscardTarget(row)}
                  onStageAll={() =>
                    void runGit('stage-all', async () => {
                      await vyotiq.workspace.gitStage({ workspaceId, all: true });
                    })
                  }
                  onUnstageAll={() =>
                    void runGit('unstage-all', async () => {
                      await vyotiq.workspace.gitUnstage({ workspaceId, all: true });
                    })
                  }
                />
                <SourceControlDiffPane
                  className="vx-sc-split-diff"
                  workspaceId={workspaceId}
                  selected={selected}
                  preview={selectedPreview}
                  onOpenInEditor={() => {
                    if (!selected || selected.status === 'D') return;
                    void openWorkspaceFile(selected.path, { workspaceId });
                  }}
                  onStage={
                    selected?.section === 'unstaged'
                      ? () => void onStage(selected)
                      : undefined
                  }
                  onUnstage={
                    selected?.section === 'staged'
                      ? () => void onUnstage(selected)
                      : undefined
                  }
                />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6">
                <div className={cn('max-w-sm space-y-2 text-center', WORKBENCH_EMPTY_CARD_CLASS)}>
                  <p className="text-section font-medium text-text-primary">Working tree clean</p>
                  <p className="text-row text-text-muted">
                    {context.ahead
                      ? `${context.ahead} commit${context.ahead === 1 ? '' : 's'} ahead of remote — push from the toolbar.`
                      : 'No staged or unstaged changes.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <PromptDialog
        open={discardTarget !== null}
        elevated
        title="Discard changes?"
        message={
          discardTarget
            ? `Permanently discard changes in ${discardTarget.path}? This cannot be undone.`
            : ''
        }
        confirmLabel="Discard"
        onSubmit={() => {
          if (!discardTarget) return;
          const row = discardTarget;
          setDiscardTarget(null);
          void onDiscard(row);
        }}
        onCancel={() => setDiscardTarget(null)}
      />

      <PromptDialog
        open={discardAllOpen}
        elevated
        title="Discard all changes?"
        message="This permanently resets tracked files and removes untracked files. This cannot be undone."
        confirmLabel="Discard all"
        onSubmit={() =>
          void runGit('discard-all', async () => {
            await vyotiq.workspace.gitDiscard({ workspaceId: workspaceId!, all: true });
            setDiscardAllOpen(false);
          })
        }
        onCancel={() => setDiscardAllOpen(false)}
      />

      <PromptDialog
        open={newBranchOpen}
        elevated
        title="Create branch"
        message="Create a new branch from the current HEAD and check it out."
        confirmLabel="Create"
        placeholder="branch-name"
        onSubmit={(name) =>
          void runGit('create-branch', async () => {
            await vyotiq.workspace.gitCreateBranch({ workspaceId: workspaceId!, branch: name, checkout: true });
            setNewBranchOpen(false);
            if (workspace?.github) await useWorkspaceStore.getState().refresh();
          })
        }
        onCancel={() => setNewBranchOpen(false)}
      />
    </div>
  );
}
