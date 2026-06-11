/**
 * One syntax-highlighted row inside a file change card.
 */

import { useMemo } from 'react';
import type { DiffLine } from '@shared/types/tool.js';
import { cn } from '../../lib/cn.js';
import { highlightLineText } from '../../lib/highlightLineText.js';

interface SnippetDiffLineProps {
  line: DiffLine;
  language?: string;
  isStreamingTip?: boolean;
}

export function SnippetDiffLine({ line, language, isStreamingTip }: SnippetDiffLineProps) {
  const html = useMemo(
    () => highlightLineText(line.text, language),
    [line.text, language]
  );

  return (
    <div
      className={cn(
        'vx-snippet-diff-line flex min-w-0 items-stretch',
        line.kind === '+' && 'vx-snippet-diff-line--add',
        line.kind === '-' && 'vx-snippet-diff-line--del',
        line.kind === ' ' && 'vx-snippet-diff-line--ctx'
      )}
      data-kind={line.kind}
    >
      <code
        className="hljs min-w-0 flex-1 whitespace-pre-wrap px-2.5 py-px font-mono text-row leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {isStreamingTip ? <span className="vyotiq-stream-cursor mr-2 self-end" aria-hidden /> : null}
    </div>
  );
}
