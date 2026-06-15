/**
 * Bespoke renderer for the `search` tool — ast-grep structural matches.
 */

import { useMemo } from 'react';
import type { ToolCall, ToolResult, SearchMatch } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { chromeCodeSurfaceClassName, chromeNoMatchesClassName } from '../../ui/SurfaceShell.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';

interface SearchInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

export function SearchInvocation({ call, result, dense, rowKey }: SearchInvocationProps) {
  const data = result?.data?.tool === 'search' ? result.data : null;

  const pattern =
    typeof call?.args?.['pattern'] === 'string'
      ? (call.args['pattern'] as string)
      : (data?.pattern ?? data?.query ?? '');

  const query =
    typeof call?.args?.['query'] === 'string'
      ? (call.args['query'] as string)
      : (data?.query ?? '');

  const language =
    typeof call?.args?.['language'] === 'string'
      ? (call.args['language'] as string)
      : data?.language;

  const kind =
    typeof call?.args?.['kind'] === 'string'
      ? (call.args['kind'] as string)
      : data?.kind;

  const displayPattern = pattern || query || kind || '';
  const hitCount = data?.matches?.length ?? 0;
  const langLabel = language ?? 'inferred';
  const matcherLabel = kind
    ? `kind:${kind}`
    : data?.matcher === 'regex'
      ? 'regex'
      : 'AST';
  const summary = `${matcherLabel} · ${langLabel} · "${displayPattern}" — ${hitCount} hit${
    hitCount === 1 ? '' : 's'
  }${data?.truncated ? ' (truncated)' : ''}`;

  const errorHint = toolErrorHint(result);

  let detail: React.ReactNode = undefined;
  if (data) {
    detail = (
      <>
        <DetailPane label="pattern">
          <div className="font-mono text-row text-text-secondary whitespace-pre-wrap break-all">
            <PatternHighlight text={displayPattern} />
          </div>
          {language ? (
            <div className="mt-1 font-mono text-meta text-text-faint">
              language: {language}
              {data.inferenceSource ? ` (${data.inferenceSource})` : ''}
            </div>
          ) : null}
          {data.autoNote ? (
            <div className="mt-1 text-meta italic text-text-faint">{data.autoNote}</div>
          ) : null}
          {data.matcher ? (
            <div className="mt-1 font-mono text-meta text-text-faint">matcher: {data.matcher}</div>
          ) : null}
          {kind ? (
            <div className="mt-1 font-mono text-meta text-text-faint">kind: {kind}</div>
          ) : null}
        </DetailPane>
        {data.matches ? <StructuralMatches matches={data.matches} /> : null}
        {data.zeroHitHints ? (
          <DetailPane label="hints">
            <div className="font-mono text-row text-text-faint whitespace-pre-wrap">
              {data.zeroHitHints.replace(/^\n# Hints:\n/, '')}
            </div>
          </DetailPane>
        ) : null}
        {data.debugQuery ? (
          <DetailPane label="parse diagnostics">
            <div className="font-mono text-row text-text-faint whitespace-pre-wrap max-h-48 overflow-auto">
              {data.debugQuery}
            </div>
          </DetailPane>
        ) : null}
      </>
    );
  } else if (result && !result.ok) {
    detail = (
      <DetailPane label="error" tone="danger">
        <div className="font-mono text-row text-danger whitespace-pre-wrap">
          {toolErrorBody(result)}
        </div>
      </DetailPane>
    );
  }

  return (
    <InvocationShell
      title="search"
      summary={summary}
      mono
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
    />
  );
}

const METAVAR_RE = /\$[A-Z_]+|\$\$\$/g;

function PatternHighlight({ text }: { text: string }) {
  const tokens: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(METAVAR_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index));
    tokens.push(
      <span key={m.index} className="text-accent">
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push(text.slice(last));
  return <>{tokens}</>;
}

const MAX_VISIBLE_MATCHES = 200;

function StructuralMatches({ matches }: { matches: SearchMatch[] }) {
  const limited = useMemo(() => matches.slice(0, MAX_VISIBLE_MATCHES), [matches]);
  const groups = useMemo(() => {
    const byFile = new Map<string, SearchMatch[]>();
    for (const m of limited) {
      const list = byFile.get(m.path) ?? [];
      list.push(m);
      byFile.set(m.path, list);
    }
    return Array.from(byFile.entries());
  }, [limited]);
  const overflow = matches.length - limited.length;

  if (groups.length === 0) {
    return <div className={chromeNoMatchesClassName}>No matches.</div>;
  }

  return (
    <DetailPane label="matches">
      <div className={chromeCodeSurfaceClassName('flex max-h-96 flex-col gap-2 px-2 py-2')}>
        {groups.map(([path, rows]) => (
          <div key={path} className="flex flex-col">
            <div className="font-mono text-row text-text-primary">{path}</div>
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex gap-2 pl-2 font-mono text-row text-text-secondary"
              >
                <span className="w-10 shrink-0 text-right text-text-faint">
                  {r.line}
                </span>
                <span className="truncate" title={r.matchedText ?? r.preview}>
                  <MatchPreview preview={r.preview} matchedText={r.matchedText} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <div className="mt-1 text-meta italic text-text-faint">
          … {overflow} more match{overflow === 1 ? '' : 'es'} not shown
        </div>
      )}
    </DetailPane>
  );
}

function MatchPreview({
  preview,
  matchedText
}: {
  preview: string;
  matchedText?: string;
}) {
  const text = matchedText ?? preview;
  const tokens: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(METAVAR_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index));
    tokens.push(
      <span key={m.index} className="text-accent">
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push(text.slice(last));
  if (tokens.length === 0) return <>{preview}</>;
  return <>{tokens}</>;
}
