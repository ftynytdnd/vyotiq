/**
 * Scrollable, monospaced block for raw output (stdout, stderr, file content,
 * web response bodies, etc.). Bounded in height so very long payloads don't
 * stretch the timeline.
 */

import { cn } from '../../../../lib/cn.js';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants.js';

// Single source of truth — same cap the orchestrator's `replayTranscript`
// applies to persisted tool output. Renderer truncation matches what the
// model will see on replay.
const MAX_CHARS = MAX_TOOL_OUTPUT_CHARS;

interface CodeBlockProps {
  body: string;
  tone?: 'default' | 'danger' | 'muted';
  maxHeight?: number;
  className?: string;
}

export function CodeBlock({
  body,
  tone = 'default',
  maxHeight = 280,
  className
}: CodeBlockProps) {
  const truncated = body.length > MAX_CHARS;
  const shown = truncated ? body.slice(0, MAX_CHARS) + '\n…[truncated]' : body;
  return (
    <pre
      className={cn(
        'scrollbar-stealth overflow-auto whitespace-pre-wrap rounded-inner bg-surface-overlay px-2.5 py-2 font-mono text-row leading-relaxed',
        tone === 'danger'
          ? 'text-danger'
          : tone === 'muted'
            ? 'text-text-muted'
            : 'text-text-secondary',
        className
      )}
      style={{ maxHeight }}
    >
      {shown}
    </pre>
  );
}
