/**
 * Bespoke renderer for the `context` tool. Surfaces the action and (for
 * `load`) the skill name; the expanded detail previews the catalogue or the
 * loaded skill body.
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { SKILL_SOURCE_LABELS } from '@shared/types/skills.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { CodeBlock } from './shared/CodeBlock.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';

interface ContextInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

export function ContextInvocation({ call, result, dense, rowKey }: ContextInvocationProps) {
  const data = result?.data?.tool === 'context' ? result.data : null;
  const action =
    (typeof call?.args?.['action'] === 'string'
      ? (call.args['action'] as string)
      : data?.action) ?? '?';
  const skill =
    (typeof call?.args?.['skill'] === 'string'
      ? (call.args['skill'] as string)
      : data?.skill) ??
    (typeof call?.args?.['pack'] === 'string' ? (call.args['pack'] as string) : data?.pack) ??
    '';

  const summary =
    action === 'list'
      ? data?.alreadyListed
        ? 'catalogue (cached)'
        : 'catalogue'
      : skill
        ? data?.alreadyLoaded
          ? `${skill} (cached)`
          : data?.source
            ? `${skill} · ${SKILL_SOURCE_LABELS[data.source as keyof typeof SKILL_SOURCE_LABELS] ?? data.source}`
            : skill
        : 'load';

  const errorHint = toolErrorHint(result);

  let detail: React.ReactNode = undefined;
  if (data?.preview) {
    detail = (
      <DetailPane label={action === 'list' ? 'skills' : 'skill'}>
        <CodeBlock body={data.preview} />
      </DetailPane>
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
      title="context"
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
