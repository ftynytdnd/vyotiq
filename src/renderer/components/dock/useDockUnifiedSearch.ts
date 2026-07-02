/**
 * Unified dock search — chats (cross-workspace), files, skills, and prompt excerpts.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ConversationMeta } from '@shared/types/chat.js';
import type { SkillMeta } from '@shared/types/skills.js';
import type { ConversationSearchHit } from '@shared/types/ipc.js';
import { displaySkillSlashName, resolveSkillAlias } from '@shared/skills/skillAliases.js';
import { collectRunningChatIds } from './collectRunningChatIds.js';
import { getWorkspaceTree } from '../../lib/workspaceTreeCache.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { vyotiq } from '../../lib/ipc.js';

const MAX_FILE_RESULTS = 40;
const MAX_CHAT_RESULTS = 40;
const MAX_SKILL_RESULTS = 12;

export interface DockSearchChatHit {
  kind: 'chat';
  id: string;
  title: string;
  workspaceId: string;
  workspaceLabel: string;
}

export interface DockSearchFileHit {
  kind: 'file';
  path: string;
}

export interface DockSearchSkillHit {
  kind: 'skill';
  name: string;
  displayName: string;
  description: string;
}

export interface DockSearchMessageHit {
  kind: 'message';
  conversationId: string;
  eventId: string;
  excerpt: string;
  conversationTitle: string;
}

export type DockSearchHit =
  | DockSearchChatHit
  | DockSearchFileHit
  | DockSearchSkillHit
  | DockSearchMessageHit;

export interface DockUnifiedSearchResults {
  skills: DockSearchSkillHit[];
  chats: DockSearchChatHit[];
  messages: DockSearchMessageHit[];
  files: DockSearchFileHit[];
  flat: DockSearchHit[];
  loadingFiles: boolean;
  loadingMessages: boolean;
  filesLoadError: boolean;
  isFiltering: boolean;
}

function filterSkills(skills: readonly SkillMeta[], query: string): DockSearchSkillHit[] {
  const q = query.trim().toLowerCase();
  const hits: DockSearchSkillHit[] = [];
  for (const skill of skills) {
    if (skill.disableModelInvocation) continue;
    const displayName = displaySkillSlashName(skill.name);
    const matches =
      !q ||
      skill.name.toLowerCase().includes(q) ||
      displayName.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      resolveSkillAlias(q) === skill.name;
    if (!matches) continue;
    hits.push({
      kind: 'skill',
      name: skill.name,
      displayName,
      description: skill.description
    });
    if (hits.length >= MAX_SKILL_RESULTS) break;
  }
  return hits.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function filterCrossWorkspaceChats(
  list: readonly ConversationMeta[],
  workspaceLabels: Map<string, string>,
  query: string,
  runningIds: ReadonlySet<string>,
  activeId: string | null,
  activeWorkspaceId: string | null
): DockSearchChatHit[] {
  const q = query.trim().toLowerCase();
  const hits: DockSearchChatHit[] = [];
  for (const c of list) {
    if (c.archived) continue;
    const wsId = c.workspaceId ?? '';
    const titleMatch = !q || c.title.toLowerCase().includes(q);
    const alwaysVisible =
      c.id === activeId ||
      runningIds.has(c.id) ||
      (!q && wsId === activeWorkspaceId);
    if (!titleMatch && !alwaysVisible) continue;
    if (q && !titleMatch) continue;
    hits.push({
      kind: 'chat',
      id: c.id,
      title: c.title,
      workspaceId: wsId,
      workspaceLabel: workspaceLabels.get(wsId) ?? 'Workspace'
    });
    if (hits.length >= MAX_CHAT_RESULTS) break;
  }
  return hits;
}

export function useDockUnifiedSearch(
  query: string,
  searchOpen: boolean,
  workspaceId: string | null
): DockUnifiedSearchResults {
  const conversations = useConversationsStore((s) => s.list);
  const activeIdByWorkspace = useConversationsStore((s) => s.activeIdByWorkspace);
  const workspaceList = useWorkspaceStore((s) => s.list);
  const workspacePath = useWorkspaceStore((s) => {
    if (!workspaceId) return '';
    const entry = s.list.find((w) => w.id === workspaceId);
    return entry?.path ?? (s.activeId === workspaceId ? s.info.path : null) ?? '';
  });

  const [fileEntries, setFileEntries] = useState<string[]>([]);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [messages, setMessages] = useState<ConversationSearchHit[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [filesLoadError, setFilesLoadError] = useState(false);

  const q = query.trim().toLowerCase();
  const isFiltering = searchOpen && q.length > 0;

  const workspaceLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const ws of workspaceList) {
      map.set(ws.id, ws.label);
    }
    return map;
  }, [workspaceList]);

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

  useEffect(() => {
    if (!isFiltering || !workspaceId) {
      setSkills([]);
      return;
    }
    let cancelled = false;
    void vyotiq.skills
      .list(workspaceId)
      .then((rows) => {
        if (!cancelled) setSkills(rows);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isFiltering, workspaceId, query]);

  useEffect(() => {
    if (!isFiltering || !workspaceId) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    void vyotiq.conversations
      .search(workspaceId, query)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isFiltering, query, workspaceId]);

  return useMemo(() => {
    if (!isFiltering || !workspaceId) {
      return {
        skills: [],
        chats: [],
        messages: [],
        files: [],
        flat: [],
        loadingFiles: false,
        loadingMessages: false,
        filesLoadError: false,
        isFiltering: false
      };
    }

    const activeId = activeIdByWorkspace[workspaceId] ?? null;
    const skillHits = filterSkills(skills, query);
    const chats = filterCrossWorkspaceChats(
      conversations,
      workspaceLabels,
      query,
      collectRunningChatIds(),
      activeId,
      workspaceId
    );

    const messageHits: DockSearchMessageHit[] = messages.map((m) => ({
      kind: 'message',
      conversationId: m.conversationId,
      eventId: m.eventId,
      excerpt: m.excerpt,
      conversationTitle: m.conversationTitle
    }));

    const files: DockSearchFileHit[] = [];
    for (const entry of fileEntries) {
      if (entry.endsWith('/')) continue;
      if (!entry.toLowerCase().includes(q)) continue;
      files.push({ kind: 'file', path: entry });
      if (files.length >= MAX_FILE_RESULTS) break;
    }

    return {
      skills: skillHits,
      chats,
      messages: messageHits,
      files,
      flat: [...skillHits, ...chats, ...messageHits, ...files],
      loadingFiles,
      loadingMessages,
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
    loadingMessages,
    messages,
    q,
    query,
    skills,
    workspaceId,
    workspaceLabels
  ]);
}
