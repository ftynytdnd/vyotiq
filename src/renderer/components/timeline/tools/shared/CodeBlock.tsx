/**
 * Scrollable, monospaced block for raw output (stdout, stderr, file content,
 * web response bodies, etc.). Bounded in height so very long payloads don't
 * stretch the timeline.
 */

import { Check, Copy } from 'lucide-react';
import { chromeCodeSurfaceClassName, chromeRevealIconActionClassName } from '../../../ui/SurfaceShell.js';
import { cn } from '../../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../../lib/shellIcons.js';
import { useCopyFeedback } from '../../../../hooks/useCopyFeedback.js';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants.js';

const MAX_CHARS = MAX_TOOL_OUTPUT_CHARS;

interface CodeBlockProps {
  body: string;
  tone?: 'default' | 'danger' | 'muted';
  maxHeight?: number;
  className?: string;
  copyable?: boolean;
  wrap?: 'wrap' | 'nowrap';
}

export function CodeBlock({
  body,
  tone = 'default',
  maxHeight = 280,
  className,
  copyable = true,
  wrap = 'wrap'
}: CodeBlockProps) {
  const truncated = body.length > MAX_CHARS;
  const shown = truncated ? body.slice(0, MAX_CHARS) + '\n…[truncated]' : body;
  const { copied, copy } = useCopyFeedback();

  const onCopy = (): void => {
    if (!shown) return;
    void copy(shown, { context: 'tool-output' });
  };

  return (
    <div className="group/code relative">
      <pre
        className={cn(
          chromeCodeSurfaceClassName(
            wrap === 'nowrap'
              ? 'whitespace-pre px-2.5 py-2 text-row leading-relaxed'
              : 'whitespace-pre-wrap px-2.5 py-2 text-row leading-relaxed'
          ),
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
      {copyable && shown.trim().length > 0 && (
        <button
          type="button"
          onClick={onCopy}
          title={copied ? 'Copied' : 'Copy'}
          aria-label={copied ? 'Copied' : 'Copy output'}
          className={cn(
            chromeRevealIconActionClassName(
              'absolute right-1.5 top-1.5 z-10 group-hover/code:opacity-100'
            ),
            'hover:text-text-secondary'
          )}
        >
          {copied ? (
            <Check className={cn(SHELL_ROW_ICON_CLASS, 'text-success')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          ) : (
            <Copy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          )}
        </button>
      )}
    </div>
  );
}
