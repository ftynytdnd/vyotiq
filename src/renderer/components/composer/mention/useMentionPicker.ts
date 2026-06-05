/**
 * Keyboard-navigable mention typeahead state shared by MentionPicker hosts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getWorkspaceTree } from '../../../lib/workspaceTreeCache.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';

export type MentionPickerRowKind =
  | 'workspace-file'
  | 'from-computer'
  | 'stub-symbol'
  | 'stub-doc'
  | 'stub-web';

export interface MentionPickerRow {
  id: string;
  kind: MentionPickerRowKind;
  label: string;
  path?: string;
  disabled?: boolean;
  hint?: string;
}

const MAX_VISIBLE = 80;

const STUB_ROWS: MentionPickerRow[] = [
  {
    id: 'stub-symbol',
    kind: 'stub-symbol',
    label: 'Symbols',
    disabled: true,
    hint: 'Coming soon'
  },
  {
    id: 'stub-doc',
    kind: 'stub-doc',
    label: 'Docs',
    disabled: true,
    hint: 'Coming soon'
  },
  {
    id: 'stub-web',
    kind: 'stub-web',
    label: 'Web',
    disabled: true,
    hint: 'Coming soon'
  }
];

export interface UseMentionPickerInput {
  open: boolean;
  query: string;
  /** Workspace-relative paths already mentioned as inline chips. */
  mentionedPaths: string[];
}

export function useMentionPicker(input: UseMentionPickerInput) {
  const { open, query, mentionedPaths } = input;
  const [tree, setTree] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const conversationId = useChatStore((s) => s.conversationId);
  const convWorkspaceId = useConversationsStore((s) => {
    if (!conversationId) return null;
    return s.list.find((m) => m.id === conversationId)?.workspaceId ?? null;
  });
  const workspacePath = useWorkspaceStore((s) => {
    const wsId = convWorkspaceId ?? s.activeId;
    const entry = wsId ? s.list.find((w) => w.id === wsId) : undefined;
    return entry?.path ?? s.info.path ?? '';
  });
  const workspaceIdForTree = convWorkspaceId ?? useWorkspaceStore.getState().activeId ?? undefined;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getWorkspaceTree(workspacePath, 5, workspaceIdForTree ?? undefined)
      .then((result) => {
        if (!cancelled) setTree(result.entries);
      })
      .catch(() => {
        if (!cancelled) setTree([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspacePath, workspaceIdForTree]);

  const rows = useMemo((): MentionPickerRow[] => {
    const q = query.trim().toLowerCase();
    const all = tree ?? [];
    const files = (
      q.length === 0 ? all : all.filter((p) => p.toLowerCase().includes(q))
    )
      .filter((p) => !p.endsWith('/'))
      .slice(0, MAX_VISIBLE)
      .map(
        (path): MentionPickerRow => ({
          id: `file:${path}`,
          kind: 'workspace-file',
          label: path,
          path,
          disabled: mentionedPaths.includes(path)
        })
      );

    const computer: MentionPickerRow = {
      id: 'from-computer',
      kind: 'from-computer',
      label: 'From computer…',
      hint: 'Pick a file outside the workspace'
    };

    return [...files, computer, ...STUB_ROWS];
  }, [tree, query, mentionedPaths]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, query, rows.length]);

  const moveActive = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      setActiveIndex((i) => {
        let next = i + delta;
        for (let step = 0; step < rows.length; step++) {
          if (next < 0) next = rows.length - 1;
          else if (next >= rows.length) next = 0;
          if (!rows[next]?.disabled) return next;
          next += delta;
        }
        return i;
      });
    },
    [rows]
  );

  const activeRow = rows[activeIndex] ?? null;

  const selectActive = useCallback((): MentionPickerRow | null => {
    const row = rows[activeIndex];
    if (!row || row.disabled) return null;
    return row;
  }, [rows, activeIndex]);

  return {
    rows,
    loading,
    activeIndex,
    setActiveIndex,
    activeRow,
    moveActive,
    selectActive,
    workspacePath
  };
}
