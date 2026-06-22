import { useEffect, useMemo, useRef, useState } from 'react';
import { ListTodo, ChevronRight, Plus } from 'lucide-react';
import type { TaskItem, TaskStatus } from '@shared/types/task.js';
import { countActiveTasks, countCompleted } from '@shared/types/task.js';
import { cn } from '../../../lib/cn.js';
import { randomId } from '../../../lib/ids.js';
import {
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE
} from '../../../lib/shellIcons.js';
import { useTasksStore } from '../../../store/useTasksStore.js';
import { TaskRow } from './TaskRow.js';

interface TaskTrayProps {
  conversationId: string;
  tasks: TaskItem[];
}

export function TaskTray({ conversationId, tasks }: TaskTrayProps) {
  const setTasks = useTasksStore((s) => s.setTasks);
  const [expanded, setExpanded] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [ariaMessage, setAriaMessage] = useState('');
  const skipAriaOnMountRef = useRef(true);

  useEffect(() => {
    const completed = countCompleted(tasks);
    const active = countActiveTasks(tasks);
    const message = `${active} tasks, ${completed} done`;
    if (skipAriaOnMountRef.current) {
      skipAriaOnMountRef.current = false;
      return;
    }
    setAriaMessage(message);
  }, [tasks]);

  const { done, active } = useMemo(() => {
    const completed = countCompleted(tasks);
    const activeCount = countActiveTasks(tasks);
    return { done: completed, active: activeCount };
  }, [tasks]);

  function persist(next: TaskItem[]) {
    void setTasks(conversationId, next);
  }

  function cycleStatus(id: string, next: TaskStatus) {
    const updated = tasks.map((t) => {
      if (t.id === id) return { ...t, status: next };
      // Enforce a single in_progress: demote any other active item so the
      // user's pick is the one that sticks (the normalizer would otherwise
      // keep the first in_progress and silently ignore this click).
      if (next === 'in_progress' && t.status === 'in_progress') {
        return { ...t, status: 'pending' as TaskStatus };
      }
      return t;
    });
    persist(updated);
  }

  function editContent(id: string, content: string) {
    persist(tasks.map((t) => (t.id === id ? { ...t, content } : t)));
  }

  function removeTask(id: string) {
    persist(tasks.filter((t) => t.id !== id));
  }

  function moveTask(id: string, direction: -1 | 1) {
    const index = tasks.findIndex((t) => t.id === id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= tasks.length) return;
    const next = [...tasks];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    persist(next);
  }

  function addTask() {
    const content = addDraft.trim();
    if (content.length === 0) return;
    persist([...tasks, { id: randomId(), content, status: 'pending' }]);
    setAddDraft('');
  }

  return (
    <div className="vx-composer-task-tray" data-testid="task-tray" role="region" aria-label="Task list">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {ariaMessage}
      </div>
      <button
        type="button"
        className="vx-task-tray-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronRight
          className={cn('vx-task-tray-chevron', expanded && 'vx-task-tray-chevron--open')}
          strokeWidth={SHELL_MICRO_ICON_STROKE}
        />
        <ListTodo className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        <span className="vx-task-tray-title">Tasks</span>
        <span className="vx-task-tray-count" title={`${done} of ${active} done`}>
          {done}/{active} done
        </span>
      </button>

      {expanded ? (
        <>
          <ul className="vx-task-list">
            {tasks.map((item, i) => (
              <TaskRow
                key={item.id}
                item={item}
                index={i}
                total={tasks.length}
                onCycleStatus={cycleStatus}
                onEditContent={editContent}
                onRemove={removeTask}
                onMove={moveTask}
              />
            ))}
          </ul>
          <div className="vx-task-add-row">
            <Plus className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
            <input
              className="vx-task-edit-input min-w-0 flex-1"
              placeholder="Add a task…"
              value={addDraft}
              onChange={(e) => setAddDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTask();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setAddDraft('');
                }
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
