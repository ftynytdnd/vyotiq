/**
 * Presentation metadata for task statuses. Keeps the icon/label/tone mapping
 * in one place so `TaskRow` and the collapsed summary stay consistent and the
 * status cycle order is defined once.
 */

import { Circle, CircleDot, CheckCircle2, CircleSlash } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TaskStatus } from '@shared/types/task.js';

export interface TaskStatusMeta {
  icon: LucideIcon;
  label: string;
  /** CSS modifier suffix on `vx-task-status--<tone>`. */
  tone: 'pending' | 'active' | 'done' | 'cancelled';
}

export const TASK_STATUS_META: Record<TaskStatus, TaskStatusMeta> = {
  pending: { icon: Circle, label: 'Pending', tone: 'pending' },
  in_progress: { icon: CircleDot, label: 'In progress', tone: 'active' },
  completed: { icon: CheckCircle2, label: 'Completed', tone: 'done' },
  cancelled: { icon: CircleSlash, label: 'Cancelled', tone: 'cancelled' }
};

/**
 * Click-cycle order for the leading status control:
 * pending -> in_progress -> completed -> cancelled -> pending.
 */
export function nextTaskStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case 'pending':
      return 'in_progress';
    case 'in_progress':
      return 'completed';
    case 'completed':
      return 'cancelled';
    case 'cancelled':
      return 'pending';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
