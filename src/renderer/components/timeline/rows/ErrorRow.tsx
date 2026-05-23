/**
 * Top-level error row. Surfaces IPC / provider / loop failures inline in
 * the timeline as a flush log-line. Backed by the shared `Notice`
 * primitive (size="sm") so the timeline's error chrome stays in lock-
 * step with the modal-side error callouts in Settings and the Context
 * Inspector — one tonal vocabulary across the whole renderer.
 *
 * `AlertTriangle` is passed explicitly to override Notice's default
 * `AlertCircle` glyph: the triangle is the long-standing convention
 * for timeline-level failures and other places (AgentThoughtRow
 * `warn`, sub-agent header `message`) still ship it.
 */

import { AlertTriangle } from 'lucide-react';
import { SurfaceShell } from '../../ui/SurfaceShell.js';
import { Notice } from '../../ui/Notice.js';

interface ErrorRowProps {
  message: string;
}

export function ErrorRow({ message }: ErrorRowProps) {
  return (
    <SurfaceShell>
      <Notice tone="danger" size="sm" icon={AlertTriangle} className="border-0 bg-transparent">
        <div className="whitespace-pre-wrap">{message}</div>
      </Notice>
    </SurfaceShell>
  );
}
