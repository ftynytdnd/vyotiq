/**
 * Top-level error row. Surfaces IPC / provider / loop failures inline in
 * the timeline as a flush log-line — no heavy card chrome, just a
 * single hairline `border-l` rail in the danger tone so multi-line
 * failures still read as a single unit.
 */

import { AlertTriangle } from 'lucide-react';

interface ErrorRowProps {
  message: string;
}

export function ErrorRow({ message }: ErrorRowProps) {
  return (
    <div className="flex items-start gap-2 border-l border-danger/50 pl-3 pr-1 py-1">
      <AlertTriangle
        className="mt-[2px] h-3.5 w-3.5 shrink-0 text-danger/90"
        strokeWidth={2.25}
      />
      <div className="whitespace-pre-wrap text-log text-danger/90">{message}</div>
    </div>
  );
}
