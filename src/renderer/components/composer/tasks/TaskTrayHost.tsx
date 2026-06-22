import { useEffect } from 'react';
import { useTasksStore, useConversationTasks } from '../../../store/useTasksStore.js';
import { TaskTray } from './TaskTray.js';

interface TaskTrayHostProps {
  conversationId: string | null;
}

/**
 * Always mounted in the composer so the hydrate effect runs on every
 * conversation change. Renders the task tray whenever a conversation is
 * active — including when the list is empty so the user can bootstrap tasks.
 */
export function TaskTrayHost({ conversationId }: TaskTrayHostProps) {
  const hydrate = useTasksStore((s) => s.hydrate);
  const tasks = useConversationTasks(conversationId);

  useEffect(() => {
    if (conversationId) void hydrate(conversationId);
  }, [conversationId, hydrate]);

  if (!conversationId) return null;
  return <TaskTray conversationId={conversationId} tasks={tasks} />;
}
