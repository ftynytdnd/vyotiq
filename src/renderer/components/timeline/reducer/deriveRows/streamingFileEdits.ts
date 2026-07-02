/**
 * Live-layer transforms for Cursor-style root-level file diff cards.
 * Routes in-flight `edit` partials out of tool-groups and flattens
 * settled edit+file-edit merges into inline cards.
 */

import type { DiffHunk } from '@shared/types/tool.js';
import type { PartialToolCallArgs, DiffStreamSnapshot } from '../types.js';
import type { Row, ToolGroupChild, FileEditCardRevision } from '../deriveRows.js';
import { editChildPath, toolGroupStatus } from './groupTools.js';
import { shouldSynthesizePartialToolEntry } from '../partialToolVisibility.js';
import { synthesizeDiffPreview } from '../../tools/edit/synthesizeDiffPreview.js';

const KNOWN_TOOL_NAMES = [
  'bash', 'ls', 'read', 'edit', 'delete', 'search', 'sg', 'memory', 'recall', 'report', 'context',
  'capture', 'unknown'
] as const;

function editPartialPath(partial: PartialToolCallArgs): string {
  const fromArgs =
    typeof partial.parsed?.['path'] === 'string' ? (partial.parsed['path'] as string) : '';
  if (fromArgs.length > 0) return fromArgs;
  return partial.diffStream?.filePath ?? '';
}

function resolveStreamingHunks(
  partial: PartialToolCallArgs,
  liveDiff?: DiffStreamSnapshot
): DiffHunk[] {
  if (liveDiff && liveDiff.tool === 'edit' && liveDiff.hunks.length > 0) {
    return liveDiff.hunks;
  }
  if (partial.diffStream && partial.diffStream.tool === 'edit' && partial.diffStream.hunks.length > 0) {
    return partial.diffStream.hunks;
  }
  const preview = synthesizeDiffPreview(partial.parsed ?? null);
  return preview?.hunks ?? [];
}

function resolveStreamingStats(
  partial: PartialToolCallArgs,
  hunks: DiffHunk[],
  liveDiff?: DiffStreamSnapshot
): { additions: number; deletions: number } {
  if (liveDiff && liveDiff.tool === 'edit') {
    return { additions: liveDiff.additions, deletions: liveDiff.deletions };
  }
  if (partial.diffStream && partial.diffStream.tool === 'edit') {
    return { additions: partial.diffStream.additions, deletions: partial.diffStream.deletions };
  }
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === '+') additions++;
      else if (line.kind === '-') deletions++;
    }
  }
  return { additions, deletions };
}

function isEditPartial(partial: PartialToolCallArgs): boolean {
  return shouldSynthesizePartialToolEntry(partial, KNOWN_TOOL_NAMES) && partialToolName(partial) === 'edit';
}

function partialToolName(partial: PartialToolCallArgs): string | undefined {
  return partial.name ?? partial.diffStream?.tool;
}

/** Drop edit entries from partial synthesis — they become file cards instead. */
export function filterNonEditPartials(
  partials: Record<string, PartialToolCallArgs>
): Record<string, PartialToolCallArgs> {
  const out: Record<string, PartialToolCallArgs> = {};
  for (const [id, p] of Object.entries(partials)) {
    if (isEditPartial(p)) continue;
    out[id] = p;
  }
  return out;
}

function interimCardFromEditChild(callId: string, child: ToolGroupChild): Row | null {
  const data = child.result?.data;
  if (!child.result?.ok || data?.tool !== 'edit') return null;
  const filePath = editChildPath(child);
  if (!filePath) return null;
  return {
    kind: 'file-edit-card',
    key: `fec:${callId}`,
    callId,
    filePath,
    additions: data.additions,
    deletions: data.deletions,
    ...(data.hunks && data.hunks.length > 0 ? { hunks: data.hunks } : {}),
    phase: 'settling'
  };
}

function settledCardFromEditChild(callId: string, child: ToolGroupChild): Row | null {
  const filePath = editChildPath(child);
  if (!filePath) return null;
  const data = child.result?.data;
  if (child.fileEditAdditions === undefined && !(data?.tool === 'edit')) return null;
  const additions = child.fileEditAdditions ?? (data?.tool === 'edit' ? data.additions : 0);
  const deletions = child.fileEditDeletions ?? (data?.tool === 'edit' ? data.deletions : 0);
  const hunks = data?.tool === 'edit' ? data.hunks : undefined;
  return {
    kind: 'file-edit-card',
    key: `fec:${callId}`,
    callId,
    filePath,
    additions,
    deletions,
    ...(hunks && hunks.length > 0 ? { hunks } : {}),
    phase: 'settled'
  };
}

/**
 * Replace successful edit tool-groups and file-edit-groups with inline
 * file cards; hide redundant edit chrome during streaming.
 */
export function flattenSettledEditRows(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    if (row.kind === 'tool-group' && row.toolName === 'edit') {
      const failed = row.children.some((c) => c.result && !c.result.ok);
      const cards: Row[] = [];
      for (const child of row.children) {
        const settled = settledCardFromEditChild(child.callId, child);
        if (settled) {
          cards.push(settled);
          continue;
        }
        const interim = interimCardFromEditChild(child.callId, child);
        if (interim) cards.push(interim);
      }
      if (!failed && cards.length === row.children.length && cards.length > 0) {
        out.push(...cards);
        continue;
      }
    }
    out.push(row);
  }
  return out;
}

function lastUserPromptIndex(rows: Row[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.kind === 'user-prompt') return i;
  }
  return -1;
}

function countExplorationInTurn(rows: Row[]): {
  fileCount: number;
  searchCount: number;
  samples: Array<{ toolName: 'read' | 'search'; path: string }>;
} {
  const start = lastUserPromptIndex(rows) + 1;
  let fileCount = 0;
  let searchCount = 0;
  const samples: Array<{ toolName: 'read' | 'search'; path: string }> = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind !== 'tool-group') continue;
    if (row.toolName !== 'read' && row.toolName !== 'search') continue;
    for (const child of row.children) {
      if (!child.result?.ok) continue;
      if (row.toolName === 'read') {
        fileCount++;
        const path =
          child.result.data?.tool === 'read'
            ? child.result.data.path
            : typeof child.call?.args?.['path'] === 'string'
              ? (child.call.args['path'] as string)
              : '';
        if (path) samples.push({ toolName: 'read', path });
      } else {
        searchCount++;
        const query =
          child.result.data?.tool === 'search'
            ? child.result.data.query
            : typeof child.call?.args?.['query'] === 'string'
              ? (child.call.args['query'] as string)
              : typeof child.call?.args?.['pattern'] === 'string'
                ? (child.call.args['pattern'] as string)
                : '';
        if (query) samples.push({ toolName: 'search', path: query });
      }
    }
  }
  return { fileCount, searchCount, samples };
}

function turnStartIndex(rows: Row[]): number {
  return lastUserPromptIndex(rows) + 1;
}

function isExplorationToolGroup(row: Row): boolean {
  return row.kind === 'tool-group' && (row.toolName === 'read' || row.toolName === 'search');
}

function isEditActivityRow(row: Row): boolean {
  if (row.kind === 'file-edit-card' || row.kind === 'file-edit-pending') return true;
  return row.kind === 'tool-group' && row.toolName === 'edit';
}

/**
 * Wire-faithful slot for the exploration rollup: right after the last
 * read/search group, before any later assistant prose or edit activity.
 */
function explorationSummaryInsertIndex(rows: Row[]): number {
  const start = turnStartIndex(rows);
  let lastReadSearchIdx = -1;
  for (let i = start; i < rows.length; i++) {
    if (isExplorationToolGroup(rows[i]!)) lastReadSearchIdx = i;
  }
  if (lastReadSearchIdx < 0) return start;

  const insertAt = lastReadSearchIdx + 1;
  for (let i = insertAt; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === 'assistant-text') return i;
    if (isEditActivityRow(row)) return i;
  }
  return insertAt;
}

/**
 * Insert streaming / settling cards at the wire edit position when known,
 * otherwise after all pre-edit prose (mockup: prose → explored → prose → cards).
 */
function fileEditStreamAnchorIndex(rows: Row[]): number {
  const start = turnStartIndex(rows);
  const exploreIdx = rows.findIndex((r, i) => i >= start && r.kind === 'exploration-summary');
  let anchor = exploreIdx >= 0 ? exploreIdx + 1 : start;

  let lastEditIdx = -1;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === 'file-edit-card' || (row.kind === 'tool-group' && row.toolName === 'edit')) {
      lastEditIdx = i;
    }
  }
  if (lastEditIdx >= 0) return lastEditIdx + 1;

  for (let i = Math.max(start, anchor); i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === 'file-edit-pending') return i;
    if (row.kind === 'assistant-text') anchor = i + 1;
    if (isEditActivityRow(row)) return i;
  }
  return anchor;
}

/** Tail slot for the live "Creating …" line — after all other turn content. */
function fileEditPendingInsertIndex(rows: Row[]): number {
  const start = turnStartIndex(rows);
  let lastContent = start - 1;
  for (let i = start; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === 'run-complete' || row.kind === 'error') break;
    lastContent = i;
  }
  return lastContent + 1;
}

const EXPLORATION_SUMMARY_KEY = 'exploration-summary';

/** Insert exploration rollup when read/search activity exists in the turn. */
export function insertExplorationSummary(rows: Row[]): Row[] {
  const start = turnStartIndex(rows);
  const { fileCount, searchCount, samples } = countExplorationInTurn(rows);
  const existingIdx = rows.findIndex((r, i) => i >= start && r.kind === 'exploration-summary');

  if (fileCount === 0 && searchCount === 0) {
    return rows;
  }

  const summary: Row = {
    kind: 'exploration-summary',
    key: EXPLORATION_SUMMARY_KEY,
    fileCount,
    searchCount,
    ...(samples.length > 0 ? { samples } : {})
  };

  if (existingIdx >= 0) {
    const out = rows.slice();
    out[existingIdx] = summary;
    return out;
  }

  const insertAt = explorationSummaryInsertIndex(rows);
  const out = rows.slice();
  out.splice(insertAt, 0, summary);
  return out;
}

function hasLiveCardForCallId(rows: Row[], callId: string): boolean {
  return rows.some((r) => r.kind === 'file-edit-card' && r.callId === callId);
}

function hasSettledCardForCallId(rows: Row[], callId: string): boolean {
  return rows.some(
    (r) => r.kind === 'file-edit-card' && r.callId === callId && r.phase === 'settled'
  );
}

function partialFromEditChild(
  child: ToolGroupChild,
  liveDiff?: DiffStreamSnapshot
): PartialToolCallArgs {
  return {
    callId: child.callId,
    name: 'edit',
    index: 0,
    argsBuf: '',
    parsed: (child.call?.args as Record<string, unknown> | undefined) ?? null,
    ts: liveDiff?.ts ?? 0,
    ...(liveDiff ? { diffStream: liveDiff } : child.diffStream ? { diffStream: child.diffStream } : {})
  };
}

function upsertStreamingCard(
  out: Row[],
  partial: PartialToolCallArgs,
  liveDiffByCallId: Record<string, DiffStreamSnapshot> | undefined,
  phaseOverride?: 'streaming' | 'settling'
): Row[] {
  const filePath = editPartialPath(partial);
  const liveDiff = liveDiffByCallId?.[partial.callId];
  const hunks = resolveStreamingHunks(partial, liveDiff);
  const stats = resolveStreamingStats(partial, hunks, liveDiff);
  const settledStream = liveDiff?.settled === true || partial.diffStream?.settled === true;

  if (hunks.length === 0 || filePath.length === 0) return out;

  const phase = phaseOverride ?? (settledStream ? 'settling' : 'streaming');
  const card: Extract<Row, { kind: 'file-edit-card' }> = {
    kind: 'file-edit-card',
    key: `fec:${partial.callId}`,
    callId: partial.callId,
    filePath,
    additions: stats.additions,
    deletions: stats.deletions,
    hunks,
    phase
  };

  const existingIdx = out.findIndex(
    (r) => r.kind === 'file-edit-card' && r.callId === partial.callId && r.phase !== 'settled'
  );
  if (existingIdx >= 0) {
    const next = out.slice();
    next[existingIdx] = card;
    return next;
  }
  const anchor = fileEditStreamAnchorIndex(out);
  const next = out.slice();
  next.splice(anchor, 0, card);
  return next;
}

/**
 * Promote in-flight edit tool-group children (tool-call landed, result
 * pending) into root-level streaming cards using persisted live diff.
 */
function promoteInFlightEditToolGroups(
  rows: Row[],
  liveDiffByCallId: Record<string, DiffStreamSnapshot> | undefined
): Row[] {
  if (!liveDiffByCallId || Object.keys(liveDiffByCallId).length === 0) return rows;

  let out = rows.slice();
  for (const row of rows) {
    if (row.kind !== 'tool-group' || row.toolName !== 'edit') continue;
    for (const child of row.children) {
      if (child.result) continue;
      if (hasLiveCardForCallId(out, child.callId)) continue;
      const liveDiff = liveDiffByCallId[child.callId] ?? child.diffStream;
      if (!liveDiff || liveDiff.tool !== 'edit') continue;
      out = upsertStreamingCard(out, partialFromEditChild(child, liveDiff), liveDiffByCallId);
    }
  }
  return out;
}

/**
 * Collapse settled read/search tool-groups once the exploration rollup is
 * shown. In-flight groups stay visible so "Reading…" does not vanish mid-run.
 */
export function suppressExploredToolGroups(rows: Row[]): Row[] {
  if (!rows.some((r) => r.kind === 'exploration-summary')) return rows;

  const start = lastUserPromptIndex(rows) + 1;
  return rows.filter((row, idx) => {
    if (idx < start) return true;
    if (row.kind !== 'tool-group') return true;
    if (row.toolName !== 'read' && row.toolName !== 'search') return true;
    return toolGroupStatus(row.children) === 'running';
  });
}

/**
 * Append live streaming / pending file cards for in-flight edit partials.
 */
export function appendLiveStreamingFileEdits(
  rows: Row[],
  partials: Record<string, PartialToolCallArgs> | undefined,
  settledCallIds: Record<string, true> | undefined,
  liveDiffByCallId: Record<string, DiffStreamSnapshot> | undefined
): Row[] {
  let out = promoteInFlightEditToolGroups(rows, liveDiffByCallId);

  if (!partials || Object.keys(partials).length === 0) return out;

  const settled = new Set(Object.keys(settledCallIds ?? {}));
  const editPartials = Object.values(partials)
    .filter((p) => isEditPartial(p) && !settled.has(p.callId))
    .sort((a, b) => a.index - b.index);

  if (editPartials.length === 0) return out;

  let pendingTail: Extract<Row, { kind: 'file-edit-pending' }> | null = null;

  for (const partial of editPartials) {
    if (hasSettledCardForCallId(out, partial.callId)) continue;

    const filePath = editPartialPath(partial);
    const liveDiff = liveDiffByCallId?.[partial.callId];
    const hunks = resolveStreamingHunks(partial, liveDiff);
    const settledStream = liveDiff?.settled === true || partial.diffStream?.settled === true;

    if (hunks.length > 0 && filePath.length > 0) {
      out = upsertStreamingCard(
        out,
        partial,
        liveDiffByCallId,
        settledStream ? 'settling' : 'streaming'
      );
      pendingTail = null;
      continue;
    }

    if (filePath.length > 0) {
      pendingTail = {
        kind: 'file-edit-pending',
        key: `fep:${partial.callId}`,
        callId: partial.callId,
        filePath
      };
    }
  }

  out = out.filter((r) => r.kind !== 'file-edit-pending');
  if (pendingTail) {
    const next = out.slice();
    next.splice(fileEditPendingInsertIndex(next), 0, pendingTail);
    out = next;
  }

  return out;
}

/** Hide edit tool-groups when file-edit-cards supersede them. */
export function suppressRedundantEditToolGroups(rows: Row[]): Row[] {
  const cardCallIds = new Set(
    rows
      .filter((r): r is Extract<Row, { kind: 'file-edit-card' }> => r.kind === 'file-edit-card')
      .map((r) => r.callId)
  );
  for (const row of rows) {
    if (row.kind !== 'file-edit-card' || !row.revisions) continue;
    for (const rev of row.revisions) {
      cardCallIds.add(rev.callId);
    }
  }
  if (cardCallIds.size === 0) return rows;

  return rows.filter((row) => {
    if (row.kind !== 'tool-group' || row.toolName !== 'edit') return true;
    const hasFailedWithoutCard = row.children.some(
      (c) => c.result && !c.result.ok && !cardCallIds.has(c.callId)
    );
    if (hasFailedWithoutCard) return true;
    const anyChildHasCard = row.children.some((c) => cardCallIds.has(c.callId));
    return !anyChildHasCard;
  });
}

type SettledFileEditCard = Extract<Row, { kind: 'file-edit-card' }> & { phase: 'settled' };

function isSettledFileEditCard(row: Row): row is SettledFileEditCard {
  return row.kind === 'file-edit-card' && row.phase === 'settled';
}

function revisionFromCard(card: SettledFileEditCard): FileEditCardRevision {
  return {
    callId: card.callId,
    additions: card.additions,
    deletions: card.deletions,
    ...(card.entryId ? { entryId: card.entryId } : {}),
    ...(card.hunks && card.hunks.length > 0 ? { hunks: card.hunks } : {})
  };
}

/** Merge adjacent settled cards for the same path into one consolidated card. */
export function consolidateSamePathFileEditCards(rows: Row[]): Row[] {
  const out: Row[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (!isSettledFileEditCard(row)) {
      out.push(row);
      i++;
      continue;
    }

    const group: SettledFileEditCard[] = [row];
    let j = i + 1;
    while (j < rows.length) {
      const next = rows[j]!;
      if (!isSettledFileEditCard(next) || next.filePath !== row.filePath) break;
      group.push(next);
      j++;
    }

    if (group.length === 1) {
      out.push(row);
    } else {
      const latest = group[group.length - 1]!;
      const priorRevisions = group.slice(0, -1).flatMap((c) => {
        const fromCard = revisionFromCard(c);
        const nested = c.revisions ?? [];
        return [...nested, fromCard];
      });
      out.push({
        ...latest,
        key: `fec-consolidated:${latest.filePath}:${latest.callId}`,
        revisions: priorRevisions.length > 0 ? priorRevisions : undefined
      });
    }
    i = j;
  }
  return out;
}
