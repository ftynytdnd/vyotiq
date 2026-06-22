import { useEffect } from 'react';
import { useTasksStore, useConversationTasks } from '../../../store/useTasksStore.js';
import { countActiveTasks } from '@shared/types/task.js';
import { TaskTray } from './TaskTray.js';

interface TaskTrayHostProps {
  conversationId: string | null;
}

/**
 * Always mounted in the composer so the hydrate effect runs on every
 * conversation change. Renders the task tray only when the agent (or user
 * co-edit) has at least one task — an empty list stays hidden.
 */
export function TaskTrayHost({ conversationId }: TaskTrayHostProps) {
  const hydrate = useTasksStore((s) => s.hydrate);
  const tasks = useConversationTasks(conversationId);

  useEffect(() => {
    if (conversationId) void hydrate(conversationId);
  }, [conversationId, hydrate]);

  if (!conversationId || countActiveTasks(tasks) === 0) return null;
  return <TaskTray conversationId={conversationId} tasks={tasks} />;
}
