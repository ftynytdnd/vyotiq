/**
 * Keyboard-navigable `/` skill slash picker state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { displaySkillSlashName, resolveSkillAlias } from '@shared/skills/skillAliases.js';
import type { SkillMeta } from '@shared/types/skills.js';
import { vyotiq } from '../../../lib/ipc.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';
import { useDockFileTreeRefreshStore } from '../../../store/useDockFileTreeRefreshStore.js';

export const CREATE_SKILL_COMMAND = 'create-skill';

export interface SkillSlashPickerRow {
  id: string;
  name: string;
  description: string;
  manualOnly: boolean;
  isBuiltinCommand?: boolean;
}

export interface UseSkillSlashPickerInput {
  open: boolean;
  query: string;
}

function matchesQuery(name: string, description: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const display = displaySkillSlashName(name).toLowerCase();
  return (
    name.toLowerCase().includes(q) ||
    display.includes(q) ||
    description.toLowerCase().includes(q) ||
    resolveSkillAlias(q) === name
  );
}

function toRow(meta: SkillMeta): SkillSlashPickerRow {
  return {
    id: meta.name,
    name: displaySkillSlashName(meta.name),
    description: meta.description,
    manualOnly: meta.disableModelInvocation === true
  };
}

export function useSkillSlashPicker(input: UseSkillSlashPickerInput) {
  const { open, query } = input;
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollFromKeyboardRef = useRef(false);

  const treeRefreshVersion = useDockFileTreeRefreshStore((s) => s.version);
  const conversationId = useChatStore((s) => s.conversationId);
  const convWorkspaceId = useConversationsStore((s) => {
    if (!conversationId) return null;
    return s.list.find((m) => m.id === conversationId)?.workspaceId ?? null;
  });
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaceId = convWorkspaceId ?? activeWorkspaceId;

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setSkills([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await vyotiq.skills.list(workspaceId);
      setSkills(rows);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh, treeRefreshVersion]);

  const rows = useMemo((): SkillSlashPickerRow[] => {
    const createRow: SkillSlashPickerRow = {
      id: CREATE_SKILL_COMMAND,
      name: CREATE_SKILL_COMMAND,
      description: 'Walk through authoring a new workspace skill (SKILL.md)',
      manualOnly: true,
      isBuiltinCommand: true
    };
    const skillRows = skills
      .map(toRow)
      .filter((r) => r.name !== CREATE_SKILL_COMMAND)
      .filter((r) => matchesQuery(r.name, r.description, query))
      .sort((a, b) => a.name.localeCompare(b.name));

    const showCreate =
      !query.trim() ||
      CREATE_SKILL_COMMAND.includes(query.trim().toLowerCase()) ||
      'create'.includes(query.trim().toLowerCase());

    if (showCreate && matchesQuery(CREATE_SKILL_COMMAND, createRow.description, query)) {
      return [createRow, ...skillRows];
    }
    return skillRows;
  }, [query, skills]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, rows.length]);

  const activeRow = rows[activeIndex] ?? null;

  const moveActive = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      scrollFromKeyboardRef.current = true;
      setActiveIndex((i) => {
        const next = i + delta;
        if (next < 0) return rows.length - 1;
        if (next >= rows.length) return 0;
        return next;
      });
    },
    [rows.length]
  );

  const selectActive = useCallback((): SkillSlashPickerRow | null => {
    return rows[activeIndex] ?? null;
  }, [activeIndex, rows]);

  return {
    rows,
    loading,
    activeIndex,
    activeRow,
    setActiveIndex,
    moveActive,
    selectActive,
    scrollFromKeyboardRef,
    refresh
  };
}
