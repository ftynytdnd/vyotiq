/**
 * Per-conversation task list mirror for the composer task tray.
 *
 * The main-side sidecar (`src/main/tasks/taskStore.ts`) is the source of
 * truth. This store is a renderer mirror, fed from three places:
 *   - `hydrate(id)` — one-shot `tasks:get` when the active conversation
 *     mounts/changes (driven by the always-mounted `TaskTrayHost`).
 *   - `applyUpdate(id, items)` — live snapshots from `todos-update` timeline
 *     events (agent writes), routed in `chatChannel`.
 *   - `setTasks(id, items)` — user edits; optimistic local update + persist
 *     via `tasks:set`, then reconcile with the normalized result.
 *
 * Keyed by conversation id so background runs in other conversations keep an
 * up-to-date list without disturbing the active view. No timers/listeners are
 * held here — consumers read via selector hooks and clean up with React.
 */

import { create } from 'zustand';
import type { TaskItem } from '@shared/types/task.js';
import { normalizeTaskItems } from '@shared/types/task.js';
import { randomId } from '../lib/ids.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';

const log = logger.child('store/tasks');

interface TasksStore {
  /** Current task list per conversation id. */
  byConversation: Record<string, TaskItem[]>;
  /** Per-conversation hydrate generation — stale IPC responses are dropped. */
  hydrateGeneration: Record<string, number>;
  /** One-shot `tasks:get` for a conversation (called when the tray mounts). */
  hydrate: (conversationId: string) => Promise<void>;
  /** Apply a full snapshot from a `todos-update` event (agent write). */
  applyUpdate: (conversationId: string, items: TaskItem[]) => void;
  /** Persist a user-edited list (replace) with an optimistic local update. */
  setTasks: (conversationId: string, items: TaskItem[]) => Promise<void>;
  /** Drop cached tasks when a conversation is removed. */
  pruneConversation: (conversationId: string) => void;
}

function bumpHydrateGeneration(
  generation: Record<string, number>,
  conversationId: string
): Record<string, number> {
  return {
    ...generation,
    [conversationId]: (generation[conversationId] ?? 0) + 1
  };
}

export const useTasksStore = create<TasksStore>((set, get) => ({
  byConversation: {},
  hydrateGeneration: {},

  hydrate: async (conversationId) => {
    if (!conversationId) return;
    const gen = (get().hydrateGeneration[conversationId] ?? 0) + 1;
    set((s) => ({
      hydrateGeneration: { ...s.hydrateGeneration, [conversationId]: gen }
    }));
    try {
      const list = await vyotiq.tasks.get(conversationId);
      if (get().hydrateGeneration[conversationId] !== gen) return;
      set((s) => ({
        byConversation: { ...s.byConversation, [conversationId]: list.items }
      }));
    } catch (err) {
      log.warn('tasks.get failed', { conversationId, err });
    }
  },

  applyUpdate: (conversationId, items) => {
    if (!conversationId) return;
    set((s) => ({
      hydrateGeneration: bumpHydrateGeneration(s.hydrateGeneration, conversationId),
      byConversation: {
        ...s.byConversation,
        [conversationId]: normalizeTaskItems(items, randomId)
      }
    }));
  },

  setTasks: async (conversationId, items) => {
    if (!conversationId) return;
    const optimistic = normalizeTaskItems(items, randomId);
    const prev = get().byConversation[conversationId];
    const gen = (get().hydrateGeneration[conversationId] ?? 0) + 1;
    set((s) => ({
      hydrateGeneration: { ...s.hydrateGeneration, [conversationId]: gen },
      byConversation: { ...s.byConversation, [conversationId]: optimistic }
    }));
    try {
      const list = await vyotiq.tasks.set(conversationId, optimistic);
      if (get().hydrateGeneration[conversationId] !== gen) return;
      set((s) => ({
        byConversation: { ...s.byConversation, [conversationId]: list.items }
      }));
    } catch (err) {
      log.warn('tasks.set failed — rolling back', { conversationId, err });
      // Roll back to the prior list so the UI never shows an edit the main
      // process rejected.
      set((s) => ({
        byConversation: { ...s.byConversation, [conversationId]: prev ?? [] }
      }));
    }
  },

  pruneConversation: (conversationId) => {
    if (!conversationId) return;
    set((s) => {
      const { [conversationId]: _items, ...byConversation } = s.byConversation;
      const { [conversationId]: _gen, ...hydrateGeneration } = s.hydrateGeneration;
      return { byConversation, hydrateGeneration };
    });
  }
}));

const EMPTY: readonly TaskItem[] = Object.freeze([]);

/** Stable selector for one conversation's tasks (avoids new-array churn). */
export function useConversationTasks(conversationId: string | null | undefined): TaskItem[] {
  return useTasksStore((s) =>
    conversationId ? s.byConversation[conversationId] ?? (EMPTY as TaskItem[]) : (EMPTY as TaskItem[])
  );
}
