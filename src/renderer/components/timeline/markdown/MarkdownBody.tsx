/**
 * MarkdownBody — sanitized GFM markdown renderer used by assistant text
 * and the memory panel. Scoped under `.vyotiq-md` (see index.css).
 *
 * Syntax highlighting via `rehype-highlight` + `highlight.js` (github-dark
 * theme). No `dangerouslySetInnerHTML`; react-markdown walks the MDAST
 * directly.
 *
 * A lightweight `<CopyButton>` overlays each fenced code block so the
 * user can grab commands / snippets without manually selecting.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { stripEmoji } from '@shared/text/emoji.js';
import { normalizeMathShortcuts } from '@shared/text/mathShortcuts.js';
import { cn } from '../../../lib/cn.js';
import { safeCopy } from '../../../lib/clipboard.js';

interface MarkdownBodyProps {
  text: string;
  className?: string;
}

// Hoist plugin tuples to module scope so React doesn't see new array
// identities on every render — avoids invalidating ReactMarkdown's
// internal memoization unnecessarily.
type MdProps = ComponentProps<typeof ReactMarkdown>;
const REMARK_PLUGINS: MdProps['remarkPlugins'] = [remarkGfm];
const REHYPE_PLUGINS: MdProps['rehypePlugins'] = [
  [rehypeHighlight, { detect: true, ignoreMissing: true }]
];

const MD_COMPONENTS: MdProps['components'] = {
  pre: PreWithCopy,
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
      {children}
    </a>
  )
};

export function MarkdownBody({ text, className }: MarkdownBodyProps) {
  // Compose the two display-side text normalizers in one memo so we
  // pay the scan cost once per delta and re-render only when the
  // input string actually changes. Order matters: emoji-strip first
  // (it can shorten the buffer), THEN expand LaTeX shortcuts (so
  // `$\to$` survives even if it sits next to a stripped pictograph).
  const sanitizedText = useMemo(
    () => normalizeMathShortcuts(stripEmoji(text)),
    [text]
  );

  // For long streamed assistant messages the full markdown tree is rebuilt
  // on every delta. Memoize on `text` so a re-render that didn't change
  // the body skips the parse entirely. The cost of memoizing is one
  // pointer compare per render; the savings on long streams are O(N²)
  // → O(N) in tokenization+highlighting work.
  const tree = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MD_COMPONENTS}
      >
        {sanitizedText}
      </ReactMarkdown>
    ),
    [sanitizedText]
  );

  return <div className={cn('vyotiq-md', className)}>{tree}</div>;
}

function PreWithCopy({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Clear the "Copied" reset timer on unmount so a copy click immediately
  // before a re-render (e.g. timeline rebuild) doesn't trigger a setState
  // on a destroyed node.
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
    const txt = preRef.current?.innerText ?? '';
    if (!txt) return;
    void safeCopy(txt, { context: 'markdown-code' }).then((ok) => {
      if (!ok || !mountedRef.current) return;
      setCopied(true);
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        resetTimerRef.current = null;
        setCopied(false);
      }, 1200);
    });
  };

  return (
    <div className="relative group">
      <pre ref={preRef}>{children}</pre>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          'app-no-drag absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-inner',
          'bg-surface-raised text-text-muted opacity-0 transition-opacity duration-150',
          'group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface-hover hover:text-text-primary'
        )}
        aria-label="Copy code"
        title={copied ? 'Copied' : 'Copy'}
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
