/**
 * `ask_user` tool card — structured or legacy question display.
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { parseAskUserArgs, resolveAskUserPayload } from '@shared/text/parseAskUser';
import { AskUserRow } from '../rows/AskUserRow.js';

interface AskUserInvocationProps {
  call: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey: string;
}

export function AskUserInvocation({ call }: AskUserInvocationProps) {
  const parsed = parseAskUserArgs(call.args ?? {});
  const payload = resolveAskUserPayload(parsed);
  return (
    <AskUserRow
      payload={payload}
      displayText={parsed.displayText}
      promptEventId={call.id}
      toolCallId={call.id}
      runId=""
      status="submitted"
    />
  );
}
