/**
 * Keyboard-navigable mention typeahead state shared by MentionPicker hosts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getWorkspaceTree } from '../../../lib/workspaceTreeCache.js';
import { vyotiq } from '../../../lib/ipc.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';
import { useDockFileTreeRefreshStore } from '../../../store/useDockFileTreeRefreshStore.js';
import {
  buildMentionFileTreeRows,
  initialMentionFolderExpansion,
  isMentionPickerSelectable,
  type MentionFileTreeRow
} from './mentionFileTree.js';

export type MentionPickerRowKind =
  | 'workspace-file'
  | 'workspace-folder'
  | 'symbol'
  | 'conversation';

export interface MentionPickerRow {
  id: string;
  kind: MentionPickerRowKind;
  /** Primary value used when inserting the mention chip. */
  label: string;
  /** Optional secondary line in the picker row. */
  subtitle?: string;
  path?: string;
  line?: number;
  conversationId?: string;
  disabled?: boolean;
  hint?: string;
  depth?: number;
  isDir?: boolean;
  isExpanded?: boolean;
  selectable?: boolean;
}

export interface MentionPickerGroup {
  kind: MentionPickerRowKind | 'workspace';
  label: string;
  rows: MentionPickerRow[];
  emptyHint?: string;
  loading?: boolean;
}

const MAX_SYMBOL_RESULTS = 20;
const MAX_CONVERSATION_RESULTS = 20;

const GROUP_LABEL = {
  workspace: 'Workspace',
  symbol: 'Symbols',
  conversation: 'Chats'
} as const;

export interface UseMentionPickerInput {
  open: boolean;
  query: string;
  /** Workspace-relative paths already mentioned as inline chips. */
  mentionedPaths: string[];
}

export function useMentionPicker(input: UseMentionPickerInput) {
  const { open, query, mentionedPaths } = input;
  const [tree, setTree] = useState<string[] | null>(null);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [symbols, setSymbols] = useState<
    Array<{ name: string; filePath: string; line: number }>
  >([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingSymbols, setLoadingSymbols] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [folderExpanded, setFolderExpanded] = useState<Set<string> | null>(null);
  const activeRowIdRef = useRef<string | null>(null);
  const scrollFromKeyboardRef = useRef(false);

  const treeRefreshVersion = useDockFileTreeRefreshStore((s) => s.version);

  const conversationId = useChatStore((s) => s.conversationId);
  const convWorkspaceId = useConversationsStore((s) => {
    if (!conversationId) return null;
    return s.list.find((m) => m.id === conversationId)?.workspaceId ?? null;
  });
  const conversationList = useConversationsStore((s) => s.list);
  const workspacePath = useWorkspaceStore((s) => {
    const wsId = convWorkspaceId ?? s.activeId;
    const entry = wsId ? s.list.find((w) => w.id === wsId) : undefined;
    return entry?.path ?? s.info.path ?? '';
  });
  const workspaceIdForTree = convWorkspaceId ?? useWorkspaceStore.getState().activeId ?? undefined;
  const hasWorkspace = Boolean(workspacePath.trim());

  useEffect(() => {
    setTree(null);
    setFolderExpanded(null);
  }, [workspacePath, workspaceIdForTree]);

  useEffect(() => {
    if (!open || !hasWorkspace) {
      if (!hasWorkspace) {
        setTree([]);
        setTreeTruncated(false);
        setLoadingFiles(false);
      }
      return;
    }
    let cancelled = false;
    setLoadingFiles((prev) => prev || tree === null);
    void getWorkspaceTree(workspacePath, 5, workspaceIdForTree ?? undefined)
      .then((result) => {
        if (cancelled) return;
        setTree(result.entries);
        setTreeTruncated(result.truncated);
      })
      .catch(() => {
        if (!cancelled) {
          setTree([]);
          setTreeTruncated(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, hasWorkspace, workspacePath, workspaceIdForTree, treeRefreshVersion]);

  useEffect(() => {
    if (!tree || folderExpanded !== null) return;
    setFolderExpanded(initialMentionFolderExpansion(tree));
  }, [tree, folderExpanded]);

  useEffect(() => {
    if (!open || !workspaceIdForTree || query.trim().length < 2) {
      setSymbols([]);
      setLoadingSymbols(false);
      return;
    }
    let cancelled = false;
    setLoadingSymbols(true);
    const handle = window.setTimeout(() => {
      void vyotiq.mentions
        .searchSymbols({ workspaceId: workspaceIdForTree, query })
        .then((result) => {
          if (!cancelled) setSymbols(result.hits);
        })
        .catch(() => {
          if (!cancelled) setSymbols([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingSymbols(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, workspaceIdForTree, query]);

  const fileRows = useMemo((): MentionFileTreeRow[] => {
    if (!tree || tree.length === 0) return [];
    return buildMentionFileTreeRows({
      paths: tree,
      query,
      mentionedPaths,
      expandedFolders: folderExpanded ?? new Set()
    });
  }, [tree, query, mentionedPaths, folderExpanded]);

  const { groups, navRows, selectableRows } = useMemo(() => {
    const q = query.trim().toLowerCase();

    const symbolRows: MentionPickerRow[] = symbols.slice(0, MAX_SYMBOL_RESULTS).map((hit) => ({
      id: `symbol:${hit.filePath}:${hit.line}:${hit.name}`,
      kind: 'symbol',
      label: hit.name,
      subtitle: `${hit.filePath}:${hit.line}`,
      path: hit.filePath,
      line: hit.line,
      selectable: true
    }));

    const convRows: MentionPickerRow[] = conversationList
      .filter((c) => c.id !== conversationId)
      .filter((c) => !convWorkspaceId || c.workspaceId === convWorkspaceId)
      .filter((c) => {
        if (!q) return true;
        const title = c.title?.toLowerCase() ?? '';
        return title.includes(q) || c.id.toLowerCase().includes(q);
      })
      .slice(0, MAX_CONVERSATION_RESULTS)
      .map((c) => ({
        id: `conversation:${c.id}`,
        kind: 'conversation',
        label: c.title?.trim() || 'Untitled chat',
        conversationId: c.id,
        hint: c.id.slice(0, 8),
        selectable: true
      }));

    const workspaceEmptyHint = !hasWorkspace
      ? 'Open a workspace to mention files'
      : loadingFiles && fileRows.length === 0
        ? 'Loading workspace files…'
        : q.length > 0 && fileRows.length === 0
          ? 'No matching files or folders'
          : undefined;

    const symbolEmptyHint = !hasWorkspace
      ? 'Open a workspace to search symbols'
      : q.length < 2
        ? 'Type 2+ characters to search symbols'
        : loadingSymbols
          ? 'Searching symbols…'
          : 'No matching symbols';

    const convEmptyHint =
      q.length > 0 ? 'No matching chats' : 'No other chats in this workspace';

    const workspaceGroup: MentionPickerGroup = {
      kind: 'workspace',
      label: GROUP_LABEL.workspace,
      rows: fileRows,
      emptyHint: fileRows.length === 0 ? workspaceEmptyHint : undefined,
      loading: loadingFiles && fileRows.length === 0
    };

    const builtGroups: MentionPickerGroup[] = [
      workspaceGroup,
      {
        kind: 'symbol',
        label: GROUP_LABEL.symbol,
        rows: symbolRows,
        emptyHint: symbolRows.length === 0 ? symbolEmptyHint : undefined,
        loading: loadingSymbols && q.length >= 2 && symbolRows.length === 0
      },
      {
        kind: 'conversation',
        label: GROUP_LABEL.conversation,
        rows: convRows,
        emptyHint: convRows.length === 0 ? convEmptyHint : undefined
      }
    ];

    const allNavRows = builtGroups.flatMap((g) => g.rows);
    const pickableRows = allNavRows.filter((row) => isMentionPickerSelectable(row));

    return { groups: builtGroups, navRows: allNavRows, selectableRows: pickableRows };
  }, [
    fileRows,
    query,
    symbols,
    conversationList,
    conversationId,
    convWorkspaceId,
    hasWorkspace,
    loadingFiles,
    loadingSymbols
  ]);

  const loading = loadingFiles && tree === null;

  useEffect(() => {
    if (!open) return;
    activeRowIdRef.current = null;
    setActiveIndex(0);
  }, [open, query]);

  useEffect(() => {
    if (!open || navRows.length === 0) {
      setActiveIndex(0);
      return;
    }
    const pinnedId = activeRowIdRef.current;
    if (pinnedId) {
      const idx = navRows.findIndex((row) => row.id === pinnedId);
      if (idx >= 0) {
        setActiveIndex(idx);
        return;
      }
    }
    setActiveIndex((i) => Math.min(i, navRows.length - 1));
  }, [navRows, open]);

  const toggleFolder = useCallback((folderPath: string) => {
    setFolderExpanded((prev) => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }, []);

  const setFolderExpandedState = useCallback((folderPath: string, expanded: boolean) => {
    setFolderExpanded((prev) => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (expanded) next.add(folderPath);
      else next.delete(folderPath);
      return next;
    });
  }, []);

  const moveActive = useCallback(
    (delta: number) => {
      if (navRows.length === 0) return;
      scrollFromKeyboardRef.current = true;
      setActiveIndex((i) => {
        let next = i + delta;
        if (next < 0) next = navRows.length - 1;
        else if (next >= navRows.length) next = 0;
        return next;
      });
    },
    [navRows]
  );

  const activeRow = navRows[activeIndex] ?? null;

  useEffect(() => {
    activeRowIdRef.current = activeRow?.id ?? null;
  }, [activeRow?.id]);

  const selectActive = useCallback((): MentionPickerRow | null => {
    const row = navRows[activeIndex];
    if (!row || !isMentionPickerSelectable(row)) return null;
    return row;
  }, [navRows, activeIndex]);

  const activateRow = useCallback((): 'picked' | 'folder-toggled' | 'noop' => {
    const row = navRows[activeIndex];
    if (!row) return 'noop';
    if (row.kind === 'workspace-folder' && row.path) {
      toggleFolder(row.path);
      return 'folder-toggled';
    }
    if (isMentionPickerSelectable(row)) return 'picked';
    return 'noop';
  }, [navRows, activeIndex, toggleFolder]);

  return {
    rows: navRows,
    selectableRows,
    groups,
    fileRows,
    loading,
    treeTruncated,
    activeIndex,
    setActiveIndex,
    activeRow,
    moveActive,
    selectActive,
    activateRow,
    toggleFolder,
    setFolderExpandedState,
    scrollFromKeyboardRef,
    workspacePath,
    hasWorkspace
  };
}
