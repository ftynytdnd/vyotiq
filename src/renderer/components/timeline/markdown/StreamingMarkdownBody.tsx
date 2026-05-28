/**
 * StreamingMarkdownBody — token-aware partial markdown for live assistant
 * prose. Switches to full GFM via `MarkdownBody` once the caller sets
 * `done`.
 */

import {
  createElement,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { Check, Copy } from 'lucide-react';
import { stripEmoji } from '@shared/text/emoji.js';
import { normalizeMathShortcuts } from '@shared/text/mathShortcuts.js';
import { displayAssistantTurnText } from '../../../lib/text.js';
import { cn } from '../../../lib/cn.js';
import { safeCopy } from '../../../lib/clipboard.js';
import { chromeRevealIconActionClassName } from '../../ui/SurfaceShell.js';
import { highlightStreamingCode } from '../../../lib/streamHighlight.js';
import { CodeLanguageEyebrow } from '../shared/CodeLanguageEyebrow.js';
import { MarkdownBody } from './MarkdownBody.js';
import { TaskCheckbox } from './TaskCheckbox.js';
import {
  parseStreamingBlocks,
  type InlineSpan,
  type StreamingBlock,
  type StreamingListItem,
  type StreamingListRoot
} from './streamingMarkdown.js';

interface StreamingMarkdownBodyProps {
  text: string;
  /** When true, hand off to the full GFM renderer. */
  done: boolean;
  className?: string;
}

export function StreamingMarkdownBody({
  text,
  done,
  className
}: StreamingMarkdownBodyProps) {
  const cleaned = useMemo(
    () => normalizeMathShortcuts(stripEmoji(displayAssistantTurnText(text))),
    [text]
  );

  const blocks = useMemo(
    () => (done ? [] : parseStreamingBlocks(cleaned)),
    [cleaned, done]
  );

  if (cleaned.length === 0) return null;

  if (done) {
    return <MarkdownBody text={cleaned} className={className} />;
  }

  return (
    <div className={cn('vyotiq-stream-md text-body leading-relaxed text-text-secondary', className)}>
      {blocks.map((block, idx) => (
        <StreamBlock key={idx} block={block} isTail={idx === blocks.length - 1} />
      ))}
      <span className="vyotiq-stream-cursor" aria-hidden />
    </div>
  );
}

const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function StreamBlock({ block, isTail }: { block: StreamingBlock; isTail: boolean }) {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level));
      const tag = HEADING_LEVELS[level - 1]!;
      return createElement(
        tag,
        {
          className: cn(
            'vyotiq-stream-heading font-semibold tracking-[-0.01em] text-accent-gold-strong',
            level <= 2 ? 'mt-3 mb-1.5 text-body' : 'mt-2 mb-1 text-row'
          )
        },
        <InlineSpans spans={block.spans} />
      );
    }
    case 'code':
      return (
        <StreamPreWithCopy
          content={block.content}
          language={block.language}
          partial={block.partial && isTail}
        />
      );
    case 'blockquote':
      return (
        <blockquote className="my-2 border-l-2 border-border-subtle pl-[0.9em] text-text-muted">
          <InlineSpans spans={block.spans} />
        </blockquote>
      );
    case 'hr':
      return <hr className="my-4 border-0 border-t border-border-subtle" />;
    case 'paragraph':
      return (
        <p className="my-1.5 whitespace-pre-wrap break-words">
          <InlineSpans spans={block.spans} />
        </p>
      );
    case 'table':
      return (
        <div className="my-2 overflow-x-auto">
          <table className="border-collapse text-row">
            <thead>
              <tr>
                {block.headers.map((cell, idx) => (
                  <th
                    key={idx}
                    className="border border-border-subtle/40 px-2 py-1 text-left font-semibold text-text-primary"
                  >
                    <InlineSpans spans={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="border border-border-subtle/30 px-2 py-1 text-text-secondary"
                    >
                      <InlineSpans spans={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'list':
      return <StreamList root={{ ordered: block.ordered, items: block.items }} />;
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return null;
    }
  }
}

function StreamList({ root }: { root: StreamingListRoot }) {
  const tag = root.ordered ? 'ol' : 'ul';
  return createElement(
    tag,
    {
      className: cn(
        'my-1 ml-[1.15em] pl-0',
        root.ordered ? 'list-decimal' : 'list-disc'
      )
    },
    root.items.map((item, idx) => <StreamListItem key={idx} item={item} />)
  );
}

function StreamListItem({ item }: { item: StreamingListItem }) {
  return (
    <li
      className={cn(
        'my-[0.1em] whitespace-pre-wrap break-words',
        item.task && 'list-none -ml-[1.15em]'
      )}
    >
      {item.task && <TaskCheckbox checked={!!item.checked} />}
      <InlineSpans spans={item.spans} />
      {item.nested && <StreamList root={item.nested} />}
    </li>
  );
}

const COPY_FEEDBACK_MS = 1200;

function StreamPreWithCopy({
  content,
  language,
  partial
}: {
  content: string;
  language?: string;
  partial: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const isEmpty = content.trim().length === 0;
  const highlighted = useMemo(
    () => highlightStreamingCode(language, content),
    [language, content]
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  if (isEmpty) return null;

  const onCopy = () => {
    void safeCopy(content, { context: 'stream-markdown-code' }).then((ok) => {
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
    <div className="group/streampre relative my-2">
      {highlighted && <CodeLanguageEyebrow language={highlighted.language} />}
      <pre
        className={cn(
          'overflow-x-auto rounded-inner border border-border-subtle/20 bg-surface-overlay/40 px-3 py-2 font-mono text-row text-text-secondary',
          partial && 'border-border-subtle/25'
        )}
      >
        {highlighted ? (
          <code
            className="hljs whitespace-pre"
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
        ) : (
          <code>{content}</code>
        )}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className={cn(
          chromeRevealIconActionClassName(
            'absolute right-1.5 top-1.5 z-10 group-hover/streampre:opacity-100'
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
    </div>
  );
}

function InlineSpans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((span, i) => (
        <InlineSpan key={i} span={span} />
      ))}
    </>
  );
}

function InlineSpan({ span }: { span: InlineSpan }): ReactNode {
  switch (span.kind) {
    case 'text':
      return <Fragment>{span.text}</Fragment>;
    case 'code':
      return (
        <code className="rounded-line bg-surface-overlay px-1 py-0.5 font-mono text-[0.9em] text-text-primary align-baseline">
          {span.text}
        </code>
      );
    case 'strong':
      return (
        <strong className="font-semibold text-text-primary">
          <InlineSpans spans={span.children} />
        </strong>
      );
    case 'em':
      return (
        <em className="italic text-text-secondary">
          <InlineSpans spans={span.children} />
        </em>
      );
    case 'strike':
      return (
        <s className="text-text-muted">
          <InlineSpans spans={span.children} />
        </s>
      );
    case 'link':
      return (
        <a
          href={span.href}
          target="_blank"
          rel="noreferrer noopener"
          referrerPolicy="no-referrer"
          className="text-accent underline decoration-accent/40 underline-offset-2"
        >
          <InlineSpans spans={span.children} />
        </a>
      );
    default: {
      const _exhaustive: never = span;
      void _exhaustive;
      return null;
    }
  }
}
