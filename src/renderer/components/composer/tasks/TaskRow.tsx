import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Trash2,
  CornerDownRight,
  CornerLeftUp,
  ListPlus
} from 'lucide-react';
import type { TaskItem, TaskStatus } from '@shared/types/task.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE
} from '../../../lib/shellIcons.js';
import { TASK_STATUS_META, nextTaskStatus } from './taskStatusMeta.js';
import { TASK_TREE_INDENT_PX } from './taskTreeModel.js';

interface TaskRowProps {
  item: TaskItem;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  siblingIndex: number;
  siblingCount: number;
  canIndent: boolean;
  onCycleStatus: (id: string, next: TaskStatus) => void;
  onEditContent: (id: string, content: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onToggleExpand: (id: string) => void;
  onAddSubTask: (parentId: string) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  subTaskDraft: string | null;
  onSubTaskDraftChange: (value: string) => void;
  onSubTaskCommit: () => void;
  onSubTaskCancel: () => void;
}

export function TaskRow({
  item,
  depth,
  hasChildren,
  isExpanded,
  siblingIndex,
  siblingCount,
  canIndent,
  onCycleStatus,
  onEditContent,
  onRemove,
  onMove,
  onToggleExpand,
  onAddSubTask,
  onIndent,
  onOutdent,
  subTaskDraft,
  onSubTaskDraftChange,
  onSubTaskCommit,
  onSubTaskCancel
}: TaskRowProps) {
  const meta = TASK_STATUS_META[item.status];
  const StatusIcon = meta.icon;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const inputRef = useRef<HTMLInputElement>(null);
  const subTaskInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (subTaskDraft !== null) {
      subTaskInputRef.current?.focus();
    }
  }, [subTaskDraft]);

  useEffect(() => {
    if (!editing) setDraft(item.content);
  }, [item.content, editing]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed.length === 0) {
      onRemove(item.id);
      return;
    }
    if (trimmed !== item.content) onEditContent(item.id, trimmed);
  }

  const canOutdent = depth > 0;

  return (
    <li
      className={cn(
        'vx-task-row',
        depth > 0 && 'vx-task-row--nested',
        item.status === 'completed' && 'vx-task-row--done',
        item.status === 'cancelled' && 'vx-task-row--cancelled'
      )}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <div
        className="vx-task-row__main"
        style={{ paddingLeft: `${8 + depth * TASK_TREE_INDENT_PX}px` }}
      >
      {hasChildren ? (
        <button
          type="button"
          className={cn(
            'vx-task-row__chevron vx-task-tray-chevron',
            isExpanded && 'vx-task-tray-chevron--open'
          )}
          aria-label={isExpanded ? 'Collapse sub-tasks' : 'Expand sub-tasks'}
          aria-expanded={isExpanded}
          onClick={() => onToggleExpand(item.id)}
        >
          <ChevronRight className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
      ) : (
        <span className="vx-task-row__chevron-spacer" aria-hidden="true" />
      )}

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
          aria-label="Add sub-task"
          title="Add sub-task"
          onClick={() => onAddSubTask(item.id)}
        >
          <ListPlus className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
        <button
          type="button"
          className="vx-btn vx-btn-quiet h-5 w-5 px-0"
          aria-label="Indent"
          title="Indent"
          disabled={!canIndent}
          onClick={() => onIndent(item.id)}
        >
          <CornerDownRight className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
        <button
          type="button"
          className="vx-btn vx-btn-quiet h-5 w-5 px-0"
          aria-label="Outdent"
          title="Outdent"
          disabled={!canOutdent}
          onClick={() => onOutdent(item.id)}
        >
          <CornerLeftUp className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
        <button
          type="button"
          className="vx-btn vx-btn-quiet h-5 w-5 px-0"
          aria-label="Move up"
          title="Move up"
          disabled={siblingIndex === 0}
          onClick={() => onMove(item.id, -1)}
        >
          <ChevronUp className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
        </button>
        <button
          type="button"
          className="vx-btn vx-btn-quiet h-5 w-5 px-0"
          aria-label="Move down"
          title="Move down"
          disabled={siblingIndex >= siblingCount - 1}
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
      </div>

      {subTaskDraft !== null ? (
        <div
          className="vx-task-sub-add-row"
          style={{ paddingLeft: `${8 + (depth + 1) * TASK_TREE_INDENT_PX}px` }}
        >
          <input
            ref={subTaskInputRef}
            className="vx-task-edit-input min-w-0 flex-1"
            placeholder="Add a sub-task…"
            value={subTaskDraft}
            onChange={(e) => onSubTaskDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubTaskCommit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onSubTaskCancel();
              }
            }}
            onBlur={onSubTaskCommit}
          />
        </div>
      ) : null}
    </li>
  );
}
