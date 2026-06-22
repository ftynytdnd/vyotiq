import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import type { TaskItem, TaskStatus } from '@shared/types/task.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE
} from '../../../lib/shellIcons.js';
import { TASK_STATUS_META, nextTaskStatus } from './taskStatusMeta.js';

interface TaskRowProps {
  item: TaskItem;
  index: number;
  total: number;
  onCycleStatus: (id: string, next: TaskStatus) => void;
  onEditContent: (id: string, content: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}

export function TaskRow({
  item,
  index,
  total,
  onCycleStatus,
  onEditContent,
  onRemove,
  onMove
}: TaskRowProps) {
  const meta = TASK_STATUS_META[item.status];
  const StatusIcon = meta.icon;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // Keep the draft in sync when the item content changes underneath an
  // un-opened editor (e.g. an agent rewrite). Never clobbers an active edit.
  useEffect(() => {
    if (!editing) setDraft(item.content);
  }, [item.content, editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed.length === 0) {
      // Empty content is treated as a removal so a cleared row never
      // persists as a blank task.
      onRemove(item.id);
      return;
    }
    if (trimmed !== item.content) onEditContent(item.id, trimmed);
  }

  return (
    <li
      className={cn(
        'vx-task-row',
        item.status === 'completed' && 'vx-task-row--done',
        item.status === 'cancelled' && 'vx-task-row--cancelled'
      )}
    >
      <button
        type="button"
        className={cn('vx-task-status', `vx-task-status--${meta.tone}`)}
        aria-label={`Status: ${meta.label}. Click to change.`}
        title={`${meta.label} — click to change`}
        onClick={() => onCycleStatus(item.id, nextTaskStatus(item.status))}
      >
        <StatusIcon className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="vx-task-edit-input min-w-0 flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(item.content);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="vx-task-content min-w-0 flex-1 text-left"
          title="Click to edit"
          onClick={() => setEditing(true)}
        >
          {item.content}
        </button>
      )}

      <div className="vx-task-row__actions shrink-0">
        <button
          type="button"
          className="vx-btn vx-btn-quiet h-5 w-5 px-0"
          aria-label="Move up"
          title="Move up"
          disabled={index === 0}
          onClick={() => onMove(item.id, -1)}
        >
          <ChevronUp className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
        <button
          type="button"
          className="vx-btn vx-btn-quiet h-5 w-5 px-0"
          aria-label="Move down"
          title="Move down"
          disabled={index === total - 1}
          onClick={() => onMove(item.id, 1)}
        >
          <ChevronDown className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
        <button
          type="button"
          className="vx-btn vx-btn-quiet h-5 w-5 px-0"
          aria-label="Remove task"
          title="Remove"
          onClick={() => onRemove(item.id)}
        >
          <Trash2 className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
      </div>
    </li>
  );
}
