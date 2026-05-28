/**
 * Scrollable, monospaced block for raw output (stdout, stderr, file content,
 * web response bodies, etc.). Bounded in height so very long payloads don't
 * stretch the timeline.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { chromeCodeSurfaceClassName, chromeRevealIconActionClassName } from '../../../ui/SurfaceShell.js';
import { cn } from '../../../../lib/cn.js';
import { safeCopy } from '../../../../lib/clipboard.js';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants.js';

const MAX_CHARS = MAX_TOOL_OUTPUT_CHARS;
const COPY_FEEDBACK_MS = 1200;

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
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const onCopy = () => {
    if (!shown) return;
    void safeCopy(shown, { context: 'tool-output' }).then((ok) => {
      if (!ok || !mountedRef.current) return;
      setCopied(true);
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        resetTimerRef.current = null;
        setCopied(false);
      }, COPY_FEEDBACK_MS);
    });
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
            <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.25} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />
          )}
        </button>
      )}
    </div>
  );
}
