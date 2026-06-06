/**
 * Bespoke renderer for the `search` tool. Shows the query in the
 * summary. Expanded detail groups local matches by file.
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
  const query =
    typeof call?.args?.['query'] === 'string'
      ? (call.args['query'] as string)
      : (data?.query ?? '');

  const hitCount = data?.matches?.length ?? 0;
  const summary = `"${query}" — ${hitCount} hit${hitCount === 1 ? '' : 's'}${
    data?.truncated ? ' (truncated)' : ''
  }`;

  const errorHint = toolErrorHint(result);

  let detail: React.ReactNode = undefined;
  if (data?.matches) {
    detail = <LocalMatches matches={data.matches} />;
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
      call={call}
      result={result}
    />
  );
}

const MAX_VISIBLE_MATCHES = 200;

function LocalMatches({ matches }: { matches: SearchMatch[] }) {
  const limited = useMemo(
    () => matches.slice(0, MAX_VISIBLE_MATCHES),
    [matches]
  );
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
    return (
      <div className={chromeNoMatchesClassName}>No matches.</div>
    );
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
                <span className="truncate" title={r.preview}>
                  {r.preview}
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
