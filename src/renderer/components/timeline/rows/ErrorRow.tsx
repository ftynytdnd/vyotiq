/**
 * Top-level error row — flush log-line backed by shared `Notice`.
 */

import { AlertTriangle } from 'lucide-react';
import { Notice } from '../../ui/Notice.js';
import { timelineLogRowClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';

interface ErrorRowProps {
  message: string;
}

export function ErrorRow({ message }: ErrorRowProps) {
  return (
    <div className={cn('vyotiq-stepfade-once', timelineLogRowClassName)} data-row-kind="error">
      <Notice tone="danger" size="sm" icon={AlertTriangle} className="border-0 bg-transparent">
        <div className="whitespace-pre-wrap">{message}</div>
      </Notice>
    </div>
  );
}
