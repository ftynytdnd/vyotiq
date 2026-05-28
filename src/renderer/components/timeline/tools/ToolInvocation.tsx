/**
 * ToolInvocation — tiny dispatcher that picks the bespoke per-tool
 * component from the `name` field on the call/result. Unknown shapes
 * route through `UnknownInvocation` so the user sees an explicit
 * "unknown tool" card instead of a misleading bash row.
 */

import type { ToolCall, ToolName, ToolResult } from '@shared/types/tool.js';
import type { DiffStreamSnapshot } from '../reducer/types.js';
import { BashInvocation } from './BashInvocation.js';
import { LsInvocation } from './LsInvocation.js';
import { ReadInvocation } from './ReadInvocation.js';
import { EditInvocation } from './EditInvocation.js';
import { DeleteInvocation } from './DeleteInvocation.js';
import { SearchInvocation } from './SearchInvocation.js';
import { MemoryInvocation } from './MemoryInvocation.js';
import { RecallInvocation } from './RecallInvocation.js';
import { ReportInvocation } from './ReportInvocation.js';
import { UnknownInvocation } from './UnknownInvocation.js';

interface ToolInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  /** When true, render the compact nested variant used inside SubAgentTrace. */
  dense?: boolean;
  /** Persistent key for expand/collapse state via useTimelineUiStore. */
  rowKey?: string;
  /**
   * Marker set by `deriveRows` for tool-group children that were
   * synthesised from streaming `tool-call-args-delta` events (the
   * authoritative `tool-call` event hasn't landed yet). Forwarded
   * to bespoke renderers so they can switch into a live-streaming
   * presentation (e.g. `EditInvocation`'s `partial` diff variant).
   */
  partial?: boolean;
  /**
   * Phase 2 — main-process FS-aware live diff snapshot. When
   * present, the bespoke renderer (`EditInvocation`,
   * `DeleteInvocation`, `BashInvocation` for detected writes)
   * paints these hunks instead of the renderer-side
   * `synthesizeDiffPreview` output. Forwarded only to renderers
   * that consume it.
   */
  diffStream?: DiffStreamSnapshot;
  retryCount?: number;
  /** When set, overrides the bespoke renderer's live auto-expand signal. */
  liveAutoExpand?: boolean;
}

export function ToolInvocation({
  call,
  result,
  dense,
  rowKey,
  partial,
  diffStream,
  retryCount,
  liveAutoExpand
}: ToolInvocationProps) {
  // Default to the unknown sentinel rather than misclassifying as bash.
  const name: ToolName = (call?.name ?? result?.name ?? 'unknown') as ToolName;
  switch (name) {
    case 'bash':
      return (
        <BashInvocation
          call={call}
          result={result}
          dense={dense}
          rowKey={rowKey}
          partial={partial}
          {...(diffStream ? { diffStream } : {})}
        />
      );
    case 'ls':
      return <LsInvocation call={call} result={result} dense={dense} rowKey={rowKey} />;
    case 'read':
      return <ReadInvocation call={call} result={result} dense={dense} rowKey={rowKey} />;
    case 'edit':
      return (
        <EditInvocation
          call={call}
          result={result}
          dense={dense}
          rowKey={rowKey}
          partial={partial}
          {...(diffStream ? { diffStream } : {})}
          {...(retryCount && retryCount > 1 ? { retryCount } : {})}
          {...(liveAutoExpand !== undefined ? { liveAutoExpand } : {})}
        />
      );
    case 'delete':
      return (
        <DeleteInvocation
          call={call}
          result={result}
          dense={dense}
          rowKey={rowKey}
          partial={partial}
          {...(diffStream ? { diffStream } : {})}
        />
      );
    case 'search':
      return <SearchInvocation call={call} result={result} dense={dense} rowKey={rowKey} />;
    case 'memory':
      return (
        <MemoryInvocation
          call={call}
          result={result}
          dense={dense}
          rowKey={rowKey}
          partial={partial}
        />
      );
    case 'recall':
      return <RecallInvocation call={call} result={result} dense={dense} rowKey={rowKey} />;
    case 'report':
      return (
        <ReportInvocation
          call={call}
          result={result}
          dense={dense}
          rowKey={rowKey}
          partial={partial}
          {...(diffStream ? { diffStream } : {})}
        />
      );
    case 'unknown':
      return <UnknownInvocation call={call} result={result} dense={dense} rowKey={rowKey} />;
    default: {
      const _exhaustive: never = name;
      void _exhaustive;
      return <UnknownInvocation call={call} result={result} dense={dense} rowKey={rowKey} />;
    }
  }
}
