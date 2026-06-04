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
  isValidElement,
  useMemo,
  useRef,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode
} from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { stripEmoji } from '@shared/text/emoji.js';
import { normalizeMathShortcuts } from '@shared/text/mathShortcuts.js';
import { chromeCodeSurfaceClassName } from '../../ui/SurfaceShell.js';
import { CodeLanguageEyebrow } from '../shared/CodeLanguageEyebrow.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.js';
import { TaskCheckbox } from './TaskCheckbox.js';

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
  table: TableWithWrap,
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      referrerPolicy="no-referrer"
      {...rest}
    >
      {children}
    </a>
  ),
  // GFM task-list checkboxes (`- [x] …` / `- [ ] …`) — remark-gfm
  // renders these as `<input type="checkbox" disabled>` inside an
  // `<li class="task-list-item">`. The native browser checkbox reads
  // as a glaring white square on the stealth-dark surface (visible
  // in the audit screenshots as awkward UI artifacts inside the
  // assistant's `Current Progress Status` list). The override here
  // swaps the native control for a small stealth-dark icon matching
  // the lucide vocabulary used by `<PreWithCopy>` and the timeline
  // action pills, and the CSS rule in `renderer/index.css`
  // (`.vyotiq-md li.task-list-item`) removes the parent list disc
  // and tightens the leading so the icon sits flush with the prose.
  input: ({ type, checked, ...rest }: InputCheckboxOverrideProps) => {
    if (type === 'checkbox') {
      return <TaskCheckbox checked={!!checked} />;
    }
    return <input type={type} checked={checked} {...rest} />;
  }
};

type InputCheckboxOverrideProps = InputHTMLAttributes<HTMLInputElement>;

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

  return <div className={cn('vyotiq-md vx-timeline-md vx-prose', className)}>{tree}</div>;
}

function TableWithWrap({ children, ...rest }: ComponentProps<'table'>) {
  return (
    <div className="vx-timeline-md-table-wrap">
      <table className="vx-timeline-md-table" {...rest}>
        {children}
      </table>
    </div>
  );
}

function preChildrenText(children?: ReactNode): string {
  const walk = (node: ReactNode): string => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(walk).join('');
    if (isValidElement<{ children?: ReactNode }>(node)) return walk(node.props.children);
    return '';
  };
  return walk(children);
}

function extractCodeLanguage(children?: ReactNode): string | undefined {
  const walk = (node: ReactNode): string | undefined => {
    if (node == null || typeof node === 'boolean') return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child);
        if (found) return found;
      }
      return undefined;
    }
    if (!isValidElement<{ className?: string; children?: ReactNode }>(node)) return undefined;
    const cls = node.props.className;
    if (typeof cls === 'string') {
      const match = cls.match(/\blanguage-([\w-]+)\b/);
      if (match?.[1]) return match[1];
    }
    return walk(node.props.children);
  };
  return walk(children);
}

function PreWithCopy({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const { copied, copy } = useCopyFeedback();
  const isEmpty = preChildrenText(children).trim().length === 0;
  const language = useMemo(() => extractCodeLanguage(children), [children]);

  if (isEmpty) return null;

  const onCopy = (): void => {
    const txt = preRef.current?.innerText ?? '';
    if (!txt) return;
    void copy(txt, { context: 'markdown-code' });
  };

  return (
    <div className="relative group">
      {language && <CodeLanguageEyebrow language={language} />}
      <pre ref={preRef}>{children}</pre>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          'app-no-drag absolute right-2 top-2 opacity-0 transition-opacity duration-150',
          // Match `<pre>` fence via {@link chromeCodeSurfaceClassName}; hover
          // uses Vyotiq UI quiet button wash on the copy affordance.
          chromeCodeSurfaceClassName(
            'vx-btn vx-btn-quiet flex h-6 w-6 items-center justify-center text-text-muted'
          ),
          'group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
        )}
        aria-label="Copy code"
        title={copied ? 'Copied' : 'Copy'}
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
