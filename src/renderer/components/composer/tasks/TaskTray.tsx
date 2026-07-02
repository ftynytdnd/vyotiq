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
import {
  addSubTaskDraft,
  defaultExpandedTaskIds,
  flattenVisibleTaskRows,
  indentTaskUsingPreviousRow,
  moveTaskAmongSiblings,
  outdentTask,
  removeTaskWithDescendants
} from './taskTreeModel.js';

interface TaskTrayProps {
  conversationId: string;
  tasks: TaskItem[];
}

export function TaskTray({ conversationId, tasks }: TaskTrayProps) {
  const setTasks = useTasksStore((s) => s.setTasks);
  const [expanded, setExpanded] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => defaultExpandedTaskIds(tasks));
  const [addDraft, setAddDraft] = useState('');
  const [subTaskDraftFor, setSubTaskDraftFor] = useState<string | null>(null);
  const [subTaskDraft, setSubTaskDraft] = useState('');
  const [ariaMessage, setAriaMessage] = useState('');
  const skipAriaOnMountRef = useRef(true);

  useEffect(() => {
    setExpandedIds((prev) => {
      const defaults = defaultExpandedTaskIds(tasks);
      const next = new Set(prev);
      for (const id of defaults) next.add(id);
      return next;
    });
  }, [tasks]);

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

  const visibleRows = useMemo(
    () => flattenVisibleTaskRows(tasks, expandedIds),
    [tasks, expandedIds]
  );

  function persist(next: TaskItem[]) {
    void setTasks(conversationId, next);
  }

  function cycleStatus(id: string, next: TaskStatus) {
    const updated = tasks.map((t) => {
      if (t.id === id) return { ...t, status: next };
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
    persist(removeTaskWithDescendants(id, tasks));
  }

  function moveTask(id: string, direction: -1 | 1) {
    persist(moveTaskAmongSiblings(tasks, id, direction));
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addTask() {
    const content = addDraft.trim();
    if (content.length === 0) return;
    persist([...tasks, { id: randomId(), content, status: 'pending' }]);
    setAddDraft('');
  }

  function beginAddSubTask(parentId: string) {
    setSubTaskDraftFor(parentId);
    setSubTaskDraft('');
    setExpandedIds((prev) => new Set(prev).add(parentId));
  }

  function commitAddSubTask() {
    if (!subTaskDraftFor) return;
    const content = subTaskDraft.trim();
    if (content.length === 0) {
      setSubTaskDraftFor(null);
      return;
    }
    persist(addSubTaskDraft(tasks, subTaskDraftFor, content, randomId()));
    setSubTaskDraft('');
    setSubTaskDraftFor(null);
  }

  function indentTask(id: string) {
    persist(indentTaskUsingPreviousRow(visibleRows, tasks, id));
  }

  function outdentTaskById(id: string) {
    persist(outdentTask(tasks, id));
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
          <ul className="vx-task-list" role="tree" aria-label="Task tree">
            {visibleRows.map((row) => (
              <TaskRow
                key={row.item.id}
                item={row.item}
                depth={row.depth}
                hasChildren={row.hasChildren}
                isExpanded={row.isExpanded}
                siblingIndex={row.siblingIndex}
                siblingCount={row.siblingCount}
                canIndent={visibleRows.findIndex((r) => r.item.id === row.item.id) > 0}
                onCycleStatus={cycleStatus}
                onEditContent={editContent}
                onRemove={removeTask}
                onMove={moveTask}
                onToggleExpand={toggleExpand}
                onAddSubTask={beginAddSubTask}
                onIndent={indentTask}
                onOutdent={outdentTaskById}
                subTaskDraft={subTaskDraftFor === row.item.id ? subTaskDraft : null}
                onSubTaskDraftChange={setSubTaskDraft}
                onSubTaskCommit={commitAddSubTask}
                onSubTaskCancel={() => {
                  setSubTaskDraftFor(null);
                  setSubTaskDraft('');
                }}
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
