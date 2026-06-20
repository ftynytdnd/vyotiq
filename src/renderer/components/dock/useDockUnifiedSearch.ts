/**
 * Unified dock search — chats in the active workspace plus workspace files.
 * Files are sourced from the renderer-side `workspaceTreeCache`.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ConversationMeta } from '@shared/types/chat.js';
import { filterDockChats } from './filterDockChats.js';
import { collectRunningChatIds } from './collectRunningChatIds.js';
import { getWorkspaceTree } from '../../lib/workspaceTreeCache.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';

const MAX_FILE_RESULTS = 40;

export interface DockSearchChatHit {
  kind: 'chat';
  id: string;
  title: string;
}

export interface DockSearchFileHit {
  kind: 'file';
  path: string;
}

export type DockSearchHit = DockSearchChatHit | DockSearchFileHit;

export interface DockUnifiedSearchResults {
  chats: DockSearchChatHit[];
  files: DockSearchFileHit[];
  /** Chats first, then files — for keyboard navigation. */
  flat: DockSearchHit[];
  loadingFiles: boolean;
  filesLoadError: boolean;
  isFiltering: boolean;
}

function toChatHits(list: ConversationMeta[]): DockSearchChatHit[] {
  return list.map((c) => ({ kind: 'chat' as const, id: c.id, title: c.title }));
}

export function useDockUnifiedSearch(
  query: string,
  searchOpen: boolean,
  workspaceId: string | null
): DockUnifiedSearchResults {
  const conversations = useConversationsStore((s) => s.list);
  const activeIdByWorkspace = useConversationsStore((s) => s.activeIdByWorkspace);
  const workspacePath = useWorkspaceStore((s) => {
    if (!workspaceId) return '';
    const entry = s.list.find((w) => w.id === workspaceId);
    return entry?.path ?? (s.activeId === workspaceId ? s.info.path : null) ?? '';
  });

  const [fileEntries, setFileEntries] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesLoadError, setFilesLoadError] = useState(false);

  const q = query.trim().toLowerCase();
  const isFiltering = searchOpen && q.length > 0;

  useEffect(() => {
    if (!isFiltering || !workspacePath) {
      setFileEntries([]);
      setLoadingFiles(false);
      setFilesLoadError(false);
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    setFilesLoadError(false);
    void getWorkspaceTree(workspacePath, 5, workspaceId ?? undefined)
      .then((result) => {
        if (!cancelled) setFileEntries(result.entries);
      })
      .catch((err) => {
        if (!cancelled) {
          setFileEntries([]);
          setFilesLoadError(true);
          const msg = err instanceof Error ? err.message : String(err);
          useToastStore.getState().show(`Could not load workspace files: ${msg}`, 'danger');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isFiltering, workspacePath, workspaceId]);

  return useMemo(() => {
    if (!isFiltering || !workspaceId) {
      return {
        chats: [],
        files: [],
        flat: [],
        loadingFiles: false,
        filesLoadError: false,
        isFiltering: false
      };
    }

    const activeId = activeIdByWorkspace[workspaceId] ?? null;
    const chatList = filterDockChats(
      conversations,
      workspaceId,
      query,
      true,
      collectRunningChatIds(),
      activeId
    );
    const chats = toChatHits(chatList);

    const files: DockSearchFileHit[] = [];
    for (const entry of fileEntries) {
      if (entry.endsWith('/')) continue;
      if (!entry.toLowerCase().includes(q)) continue;
      files.push({ kind: 'file', path: entry });
      if (files.length >= MAX_FILE_RESULTS) break;
    }

    return {
      chats,
      files,
      flat: [...chats, ...files],
      loadingFiles,
      filesLoadError,
      isFiltering: true
    };
  }, [
    activeIdByWorkspace,
    conversations,
    fileEntries,
    filesLoadError,
    isFiltering,
    loadingFiles,
    q,
    query,
    workspaceId
  ]);
}
