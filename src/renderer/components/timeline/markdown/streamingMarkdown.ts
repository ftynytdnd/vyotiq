/**
 * Lightweight streaming-safe markdown parser for live assistant prose.
 *
 * Full `react-markdown` + highlight.js rebuilds the entire MDAST on every
 * RAF-coalesced delta — O(n²) over a long stream — and applying shimmer
 * over the rendered tree breaks inline `<code>` (audit C2). This module
 * parses a safe subset incrementally and renders via plain React elements
 * with opaque text fills.
 *
 * Supported while streaming:
 *   - ATX headings (# … ######)
 *   - Paragraphs (blank-line separated)
 *   - Blockquotes (`> …`, consecutive lines merged)
 *   - Horizontal rules (`---` / `___` / `***` on a line alone)
 *   - Unordered (`- `, `* `, `+ `) and ordered (`1. `) list blocks
 *     with single-level nesting via indent
 *   - GFM pipe tables (header + separator row trigger)
 *   - Inline `code`, **strong**, *em*, ~~strike~~, [links](url)
 *   - Fenced ``` code blocks (partial tail fence stays in a `<pre>`)
 *
 * **Tail-block partial fix** — an unmatched opener at the absolute end of
 * the live stream is treated as a streaming-open span so literal marker
 * characters do not leak mid-stream.
 *
 * On `agent-text-end`, callers hand off to `MarkdownBody` for full GFM.
 */

export type InlineSpan =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: InlineSpan[] }
  | { kind: 'em'; children: InlineSpan[] }
  | { kind: 'strike'; children: InlineSpan[] }
  | { kind: 'link'; href: string; children: InlineSpan[] };

export interface StreamingListItem {
  spans: InlineSpan[];
  task?: boolean;
  checked?: boolean;
  nested?: StreamingListRoot;
}

export interface StreamingListRoot {
  ordered: boolean;
  items: StreamingListItem[];
}

export type StreamingBlock =
  | { kind: 'heading'; level: number; spans: InlineSpan[] }
  | { kind: 'paragraph'; spans: InlineSpan[] }
  | { kind: 'blockquote'; spans: InlineSpan[] }
  | { kind: 'hr' }
  | { kind: 'list'; ordered: boolean; items: StreamingListItem[] }
  | { kind: 'table'; headers: InlineSpan[][]; rows: InlineSpan[][][]; partial: boolean }
  | { kind: 'code'; language?: string; content: string; partial: boolean };

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const FENCE_OPEN_RE = /^```(\w*)$/;
const UL_LIST_RE = /^\s*([-*+])\s+(.*)$/;
const OL_LIST_RE = /^\s*(\d+)\.\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(\*{3,}|-{3,}|_{3,})\s*$/;
const TASK_RE = /^\[( |x|X)\]\s+(.*)$/;
const TABLE_SEP_CELL_RE = /^:?-+:?$/;

interface ListLineMatch {
  ordered: boolean;
  rest: string;
  task?: boolean;
  checked?: boolean;
  indent: number;
}

function listLineIndent(line: string): number {
  const leading = line.match(/^(\s*)/)?.[1]?.length ?? 0;
  return Math.floor(leading / 2);
}

function matchListPrefix(line: string): Omit<ListLineMatch, 'indent'> | null {
  const ul = UL_LIST_RE.exec(line);
  if (ul) {
    const rest = ul[2] ?? '';
    const task = TASK_RE.exec(rest);
    if (task) {
      return {
        ordered: false,
        rest: task[2] ?? '',
        task: true,
        checked: (task[1] ?? '').toLowerCase() === 'x'
      };
    }
    return { ordered: false, rest };
  }
  const ol = OL_LIST_RE.exec(line);
  if (ol) return { ordered: true, rest: ol[2] ?? '' };
  return null;
}

function matchListLine(line: string): ListLineMatch | null {
  const base = matchListPrefix(line);
  if (!base) return null;
  return { ...base, indent: listLineIndent(line) };
}

function buildListTree(
  lines: Array<{ indent: number; ordered: boolean; item: StreamingListItem }>
): StreamingListRoot {
  if (lines.length === 0) return { ordered: false, items: [] };
  const baseIndent = lines[0]!.indent;
  const root: StreamingListRoot = { ordered: lines[0]!.ordered, items: [] };
  const stack: Array<{ indent: number; list: StreamingListRoot }> = [
    { indent: baseIndent - 1, list: root }
  ];
  let prevIndent = baseIndent - 1;

  for (const line of lines) {
    while (stack.length > 1 && line.indent < stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    if (line.indent > prevIndent) {
      const frame = stack[stack.length - 1]!;
      const parentItem = frame.list.items[frame.list.items.length - 1];
      if (parentItem) {
        const nested: StreamingListRoot =
          parentItem.nested ?? { ordered: line.ordered, items: [] };
        parentItem.nested = nested;
        stack.push({ indent: line.indent, list: nested });
      }
    }
    stack[stack.length - 1]!.list.items.push(line.item);
    prevIndent = line.indent;
  }

  return root;
}

function parseTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableCells(line);
  if (!cells || cells.length === 0) return false;
  return cells.every((c) => TABLE_SEP_CELL_RE.test(c));
}

function isSpecialLine(line: string): boolean {
  return (
    line.startsWith('```') ||
    HEADING_RE.test(line) ||
    HR_RE.test(line.trim()) ||
    BLOCKQUOTE_RE.test(line) ||
    matchListPrefix(line) !== null
  );
}

/**
 * Parse inline markdown spans from a single logical line of prose.
 */
export function parseInlineSpans(line: string, partial = false): InlineSpan[] {
  const out: InlineSpan[] = [];
  let i = 0;

  const pushText = (text: string) => {
    if (text.length === 0) return;
    const tail = out[out.length - 1];
    if (tail?.kind === 'text') {
      tail.text += text;
    } else {
      out.push({ kind: 'text', text });
    }
  };

  while (i < line.length) {
    // Link [text](url)
    if (line[i] === '[') {
      const closeBracket = line.indexOf(']', i + 1);
      if (closeBracket !== -1 && line[closeBracket + 1] === '(') {
        const label = line.slice(i + 1, closeBracket);
        const closeParen = line.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const href = line.slice(closeBracket + 2, closeParen);
          out.push({
            kind: 'link',
            href,
            children: parseInlineSpans(label)
          });
          i = closeParen + 1;
          continue;
        }
        // Streaming-open link: `](` seen but no closing `)`.
        if (partial) {
          const href = line.slice(closeBracket + 2);
          out.push({
            kind: 'link',
            href,
            children: parseInlineSpans(label, true)
          });
          i = line.length;
          continue;
        }
      }
    }

    // Inline code
    if (line[i] === '`') {
      const close = line.indexOf('`', i + 1);
      if (close !== -1) {
        out.push({ kind: 'code', text: line.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      if (partial && i + 1 < line.length) {
        out.push({ kind: 'code', text: line.slice(i + 1) });
        i = line.length;
        continue;
      }
      pushText(line.slice(i));
      break;
    }

    // Strikethrough ~~
    if (line.startsWith('~~', i)) {
      const close = line.indexOf('~~', i + 2);
      if (close !== -1) {
        out.push({
          kind: 'strike',
          children: parseInlineSpans(line.slice(i + 2, close))
        });
        i = close + 2;
        continue;
      }
      if (partial && i + 2 < line.length) {
        out.push({
          kind: 'strike',
          children: parseInlineSpans(line.slice(i + 2), true)
        });
        i = line.length;
        continue;
      }
    }

    // Bold **
    if (line.startsWith('**', i)) {
      const close = line.indexOf('**', i + 2);
      if (close !== -1) {
        out.push({
          kind: 'strong',
          children: parseInlineSpans(line.slice(i + 2, close))
        });
        i = close + 2;
        continue;
      }
      if (partial && i + 2 < line.length) {
        out.push({
          kind: 'strong',
          children: parseInlineSpans(line.slice(i + 2), true)
        });
        i = line.length;
        continue;
      }
    }

    // Italic * (single, not **)
    if (line[i] === '*' && line[i + 1] !== '*') {
      const close = line.indexOf('*', i + 1);
      if (close !== -1 && line[close + 1] !== '*') {
        out.push({
          kind: 'em',
          children: parseInlineSpans(line.slice(i + 1, close))
        });
        i = close + 1;
        continue;
      }
      if (partial && i + 1 < line.length) {
        out.push({
          kind: 'em',
          children: parseInlineSpans(line.slice(i + 1), true)
        });
        i = line.length;
        continue;
      }
    }

    const nextSpecial = (() => {
      let j = i + 1;
      while (j < line.length) {
        const c = line[j]!;
        if (c === '`' || c === '*' || c === '[' || c === '~') return j;
        j++;
      }
      return line.length;
    })();
    pushText(line.slice(i, nextSpecial));
    i = nextSpecial;
  }

  return out.length > 0 ? out : [{ kind: 'text', text: '' }];
}

/**
 * Split accumulated stream text into render blocks.
 */
export function parseStreamingBlocks(text: string): StreamingBlock[] {
  if (text.length === 0) return [];

  const lines = text.split('\n');
  const blocks: StreamingBlock[] = [];
  type RawSrc =
    | { kind: 'heading'; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'blockquote'; text: string }
    | { kind: 'list'; itemTexts: string[] }
    | null;
  const rawSrc: RawSrc[] = [];

  let i = 0;
  let paraLines: string[] = [];

  const flushParagraph = () => {
    if (paraLines.length === 0) return;
    const joined = paraLines.join('\n');
    blocks.push({ kind: 'paragraph', spans: parseInlineSpans(joined) });
    rawSrc.push({ kind: 'paragraph', text: joined });
    paraLines = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const isLastLine = i === lines.length - 1;

    if (line.startsWith('```')) {
      flushParagraph();
      const langMatch = FENCE_OPEN_RE.exec(line.trim());
      const language = langMatch?.[1]?.length ? langMatch[1] : undefined;
      i++;
      const codeLines: string[] = [];
      let closed = false;
      while (i < lines.length) {
        if (lines[i]!.startsWith('```')) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(lines[i]!);
        i++;
      }
      blocks.push({
        kind: 'code',
        ...(language !== undefined ? { language } : {}),
        content: codeLines.join('\n'),
        partial: !closed
      });
      rawSrc.push(null);
      continue;
    }

    if (HR_RE.test(line.trim())) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      rawSrc.push(null);
      i++;
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      flushParagraph();
      const headingText = headingMatch[2]!;
      blocks.push({
        kind: 'heading',
        level: headingMatch[1]!.length,
        spans: parseInlineSpans(headingText)
      });
      rawSrc.push({ kind: 'heading', text: headingText });
      i++;
      continue;
    }

    const blockquoteMatch = BLOCKQUOTE_RE.exec(line);
    if (blockquoteMatch) {
      flushParagraph();
      const quoteLines: string[] = [blockquoteMatch[1] ?? ''];
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        if (l.trim().length === 0) break;
        if (isSpecialLine(l) && !BLOCKQUOTE_RE.test(l)) break;
        const m = BLOCKQUOTE_RE.exec(l);
        if (!m) break;
        quoteLines.push(m[1] ?? '');
        i++;
      }
      const joined = quoteLines.join('\n');
      blocks.push({ kind: 'blockquote', spans: parseInlineSpans(joined) });
      rawSrc.push({ kind: 'blockquote', text: joined });
      continue;
    }

    const headerCells = parseTableCells(line);
    if (headerCells && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) {
      flushParagraph();
      const headers = headerCells.map((c) => parseInlineSpans(c));
      i += 2;
      const rows: InlineSpan[][][] = [];
      while (i < lines.length) {
        const cells = parseTableCells(lines[i]!);
        if (!cells) break;
        rows.push(cells.map((c) => parseInlineSpans(c)));
        i++;
      }
      blocks.push({
        kind: 'table',
        headers,
        rows,
        partial: isLastLine && rows.length === 0
      });
      rawSrc.push(null);
      continue;
    }

    const listMatch = matchListLine(line);
    if (listMatch) {
      flushParagraph();
      const rootOrdered = listMatch.ordered;
      const rootIndent = listMatch.indent;
      const parsedLines: Array<{
        indent: number;
        ordered: boolean;
        item: StreamingListItem;
        raw: string;
      }> = [];
      while (i < lines.length) {
        const l = lines[i]!;
        if (l.trim().length === 0) break;
        if (l.startsWith('```')) break;
        if (HEADING_RE.test(l)) break;
        if (HR_RE.test(l.trim())) break;
        if (BLOCKQUOTE_RE.test(l)) break;
        const cells = parseTableCells(l);
        if (cells && i + 1 < lines.length && isTableSeparator(lines[i + 1]!)) break;
        const m = matchListLine(l);
        if (!m) break;
        if (m.ordered !== rootOrdered && m.indent === rootIndent) break;
        const item: StreamingListItem = { spans: parseInlineSpans(m.rest) };
        if (m.task) {
          item.task = true;
          item.checked = m.checked;
        }
        parsedLines.push({
          indent: m.indent,
          ordered: m.ordered,
          item,
          raw: m.rest
        });
        i++;
      }
      const tree = buildListTree(parsedLines);
      blocks.push({ kind: 'list', ordered: tree.ordered, items: tree.items });
      rawSrc.push({ kind: 'list', itemTexts: parsedLines.map((p) => p.raw) });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      i++;
      continue;
    }

    paraLines.push(line);
    if (!isLastLine && lines[i + 1]!.trim().length === 0) {
      flushParagraph();
    }
    i++;
  }

  flushParagraph();

  const tailIdx = blocks.length - 1;
  if (tailIdx >= 0) {
    const tail = blocks[tailIdx]!;
    const src = rawSrc[tailIdx];
    if (tail.kind === 'heading' && src?.kind === 'heading') {
      tail.spans = parseInlineSpans(src.text, true);
    } else if (tail.kind === 'paragraph' && src?.kind === 'paragraph') {
      tail.spans = parseInlineSpans(src.text, true);
    } else if (tail.kind === 'blockquote' && src?.kind === 'blockquote') {
      tail.spans = parseInlineSpans(src.text, true);
    } else if (tail.kind === 'list' && src?.kind === 'list') {
      const lastRaw = src.itemTexts[src.itemTexts.length - 1];
      if (typeof lastRaw === 'string') {
        applyPartialToListTree(tail.items, lastRaw);
      }
    }
  }

  return blocks;
}

function applyPartialToListTree(items: StreamingListItem[], raw: string): void {
  const leaf = lastListLeaf(items);
  if (leaf) leaf.spans = parseInlineSpans(raw, true);
}

function lastListLeaf(items: StreamingListItem[]): StreamingListItem | null {
  const last = items[items.length - 1];
  if (!last) return null;
  if (last.nested?.items.length) return lastListLeaf(last.nested.items);
  return last;
}
