/** Walk inline stream rows and group consecutive worker-scoped rows for
 * Delegation stream rendering (inline worker mini-threads).
 */

import type { DisplayRow } from '../shared/displayRowTypes.js';

export type DelegationStreamSegment =
  | { kind: 'orchestrator'; rows: DisplayRow[] }
  | { kind: 'worker'; subagentId: string; rows: DisplayRow[] };

function rowSubagentId(row: DisplayRow): string | undefined {
  switch (row.kind) {
    case 'subagent-line':
      return row.subagentId;
    case 'assistant-text':
    case 'reasoning-line':
    case 'tool-group':
    case 'file-edit-group':
      return row.subagentId;
    default:
      return undefined;
  }
}

/** Worker segment key — orchestrator `delegate` tool rows never nest under workers. */
function workerScopeId(row: DisplayRow): string | undefined {
  const sid = rowSubagentId(row);
  if (!sid) return undefined;
  if (row.kind === 'tool-group' && row.toolName === 'delegate') return undefined;
  return sid;
}

export function segmentDelegationStream(rows: DisplayRow[]): DelegationStreamSegment[] {
  const segments: DelegationStreamSegment[] = [];
  let orchestratorBuf: DisplayRow[] = [];
  let workerId: string | null = null;
  let workerBuf: DisplayRow[] = [];

  const flushOrchestrator = () => {
    if (orchestratorBuf.length === 0) return;
    segments.push({ kind: 'orchestrator', rows: orchestratorBuf });
    orchestratorBuf = [];
  };

  const flushWorker = () => {
    if (workerId === null || workerBuf.length === 0) return;
    segments.push({ kind: 'worker', subagentId: workerId, rows: workerBuf });
    workerId = null;
    workerBuf = [];
  };

  for (const row of rows) {
    const sid = workerScopeId(row);
    if (sid) {
      flushOrchestrator();
      if (workerId !== null && workerId !== sid) flushWorker();
      workerId = sid;
      workerBuf.push(row);
      continue;
    }
    flushWorker();
    orchestratorBuf.push(row);
  }

  flushWorker();
  flushOrchestrator();
  return segments;
}
