/**
 * StreamingMarkdownBody — token-aware partial markdown for live assistant
 * prose. Switches to full GFM via `MarkdownBody` once the caller sets
 * `done`.
 */

import {
  createElement,
  Fragment,
  memo,
  useMemo,
  type ReactNode
} from 'react';
import { Check, Copy } from 'lucide-react';
import { stripEmoji } from '@shared/text/emoji.js';
import { normalizeMathShortcuts } from '@shared/text/mathShortcuts.js';
import { displayAssistantTurnText } from '../../../lib/text.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.js';
import { chromeRevealIconActionClassName } from '../../ui/SurfaceShell.js';
import { highlightStreamingCode } from '../../../lib/streamHighlight.js';
import { CodeLanguageEyebrow } from '../shared/CodeLanguageEyebrow.js';
import { useThrottledValue } from '../../../lib/useThrottledValue.js';
import { MarkdownBody } from './MarkdownBody.js';
import { TaskCheckbox } from './TaskCheckbox.js';
import { MdTable } from './MdTable.js';
import { MdLink } from './MdLink.js';
import { healStreamingMarkdown } from './healStreamingMarkdown.js';
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

const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function spanText(spans: InlineSpan[]): string {
  return spans
    .map((s) => {
      if (s.kind === 'text' || s.kind === 'code') return s.text;
      if ('children' in s) return spanText(s.children);
      return '';
    })
    .join('');
}

function blockContentKey(block: StreamingBlock): string {
  switch (block.kind) {
    case 'heading':
      return `h${block.level}:${spanText(block.spans)}`;
    case 'paragraph':
      return `p:${spanText(block.spans)}`;
    case 'blockquote':
      return `bq:${spanText(block.spans)}`;
    case 'hr':
      return 'hr';
    case 'list':
      return `list:${block.ordered ? 'ol' : 'ul'}:${block.items.length}`;
    case 'table':
      return `table:${block.headers.length}:${block.rows.length}:${block.preview ? 'pv' : 'd'}:${block.partial ? 'p' : 'd'}`;
    case 'code':
      return `code:${block.language ?? ''}:${block.partial ? 'p' : 'd'}:${block.content.slice(0, 48)}`;
    default:
      return 'unknown';
  }
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

  const throttledCleaned = useThrottledValue(cleaned, done ? 0 : 120);
  const streamSource = done ? cleaned : throttledCleaned;

  const blocks = useMemo(
    () => (done ? [] : parseStreamingBlocks(healStreamingMarkdown(streamSource))),
    [streamSource, done]
  );

  if (cleaned.length === 0) return null;

  const proseClass = cn(
    'vyotiq-md vx-timeline-md vyotiq-stream-md vx-timeline-stream-md vx-prose',
    className
  );

  return (
    <div className={proseClass}>
      {done ? (
        <MarkdownBody text={cleaned} embedded />
      ) : (
        blocks.map((block, idx) => (
          <StreamBlock
            key={`${idx}:${blockContentKey(block)}`}
            block={block}
            isTail={idx === blocks.length - 1}
          />
        ))
      )}
    </div>
  );
}

function streamHeadingClassName(level: number): string {
  const base = 'vx-timeline-stream-heading vyotiq-stream-heading font-medium tracking-normal';
  switch (level) {
    case 1:
      return cn(base, 'mt-3 mb-1.5 text-[1.05rem] text-text-primary');
    case 2:
      return cn(base, 'mt-3 mb-1.5 text-[1rem] text-text-primary');
    case 3:
      return cn(base, 'mt-2 mb-1 text-[1rem] text-text-primary');
    case 4:
      return cn(base, 'mt-2 mb-1 text-[0.92rem] text-text-secondary');
    case 5:
    case 6:
      return cn(base, 'mt-2 mb-1 text-chat-meta text-text-primary');
    default: {
      const _exhaustive: never = level as never;
      return _exhaustive;
    }
  }
}

const StreamBlock = memo(
  function StreamBlock({ block, isTail }: { block: StreamingBlock; isTail: boolean }) {
    switch (block.kind) {
      case 'heading': {
        const level = Math.min(6, Math.max(1, block.level));
        const tag = HEADING_LEVELS[level - 1]!;
        return createElement(
          tag,
          {
            className: streamHeadingClassName(level)
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
          <blockquote className="my-2 border-l-2 border-border-subtle/30 pl-[0.9em] vx-caption">
            <InlineSpans spans={block.spans} />
          </blockquote>
        );
      case 'hr':
        return <hr className="my-4 border-0 border-t border-border-subtle/20" />;
      case 'paragraph':
        return (
          <p className="my-1.5 whitespace-pre-wrap break-words">
            <InlineSpans spans={block.spans} />
          </p>
        );
      case 'table':
        return (
          <MdTable
            busy={block.preview}
            head={
              <tr>
                {block.headers.map((cell, idx) => (
                  <th key={idx}>
                    <InlineSpans spans={cell} />
                  </th>
                ))}
              </tr>
            }
            body={
              <>
                {block.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx}>
                        <InlineSpans spans={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            }
          />
        );
      case 'list':
        return <StreamList root={{ ordered: block.ordered, items: block.items }} />;
      default: {
        const _exhaustive: never = block;
        void _exhaustive;
        return null;
      }
    }
  },
  (prev, next) => {
    if (next.isTail || prev.isTail) {
      return (
        prev.isTail === next.isTail &&
        blockContentKey(prev.block) === blockContentKey(next.block)
      );
    }
    return blockContentKey(prev.block) === blockContentKey(next.block);
  }
);

function StreamList({ root }: { root: StreamingListRoot }) {
  const tag = root.ordered ? 'ol' : 'ul';
  return createElement(
    tag,
    {
      className: cn(root.ordered ? 'list-decimal' : 'list-disc')
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

function StreamPreWithCopy({
  content,
  language,
  partial
}: {
  content: string;
  language?: string;
  partial: boolean;
}) {
  const { copied, copy } = useCopyFeedback();
  const isEmpty = content.trim().length === 0;
  const throttledContent = useThrottledValue(content, partial ? 120 : 0);
  const highlighted = useMemo(
    () => highlightStreamingCode(language, throttledContent),
    [language, throttledContent]
  );

  if (isEmpty) return null;

  const onCopy = (): void => {
    void copy(content, { context: 'stream-markdown-code' });
  };

  return (
    <div className="group/streampre relative my-2">
      {highlighted && <CodeLanguageEyebrow language={highlighted.language} />}
      <pre
        className={cn(
          'vx-timeline-stream-pre overflow-x-auto',
          partial && 'vx-timeline-stream-pre-partial'
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
          <Check className={cn(SHELL_ROW_ICON_CLASS, 'text-success')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        ) : (
          <Copy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
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
        <code className="vx-timeline-stream-inline-code">
          {span.text}
        </code>
      );
    case 'strong':
      return (
        <strong className="font-medium text-text-primary">
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
        <MdLink href={span.href}>
          <InlineSpans spans={span.children} />
        </MdLink>
      );
    default: {
      const _exhaustive: never = span;
      void _exhaustive;
      return null;
    }
  }
}
