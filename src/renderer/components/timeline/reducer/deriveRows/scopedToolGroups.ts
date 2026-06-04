/**
 * Shared tool-group / file-edit-group folding for orchestrator and sub-agent scopes.
 */

import type { ToolCall, ToolName, ToolResult } from '@shared/types/tool.js';
import type { FileEditGroupChild, Row } from '../deriveRows.js';
import { editChildPath } from './groupTools.js';

export interface ScopedGroupState {
  openToolGroupIdx: number | null;
  openFileEditGroupIdx: number | null;
  callIdToGroupIdx: Map<string, number>;
  callIdToChildIdx: Map<string, number>;
}

function toolGroupMatchesScope(
  row: Row | undefined,
  toolName: ToolName,
  subagentId: string | undefined
): row is Extract<Row, { kind: 'tool-group' }> {
  if (!row || row.kind !== 'tool-group') return false;
  if (row.toolName !== toolName) return false;
  return row.subagentId === subagentId;
}

function fileEditGroupMatchesScope(
  row: Row | undefined,
  subagentId: string | undefined
): row is Extract<Row, { kind: 'file-edit-group' }> {
  if (!row || row.kind !== 'file-edit-group') return false;
  return row.subagentId === subagentId;
}

export function foldToolCall(
  out: Row[],
  state: ScopedGroupState,
  call: ToolCall,
  subagentId?: string
): void {
  const scopeId = subagentId;
  const existingGroupIdx = state.callIdToGroupIdx.get(call.id);
  const existingChildIdx = state.callIdToChildIdx.get(call.id);
  if (
    existingGroupIdx !== undefined &&
    existingChildIdx !== undefined &&
    out[existingGroupIdx]?.kind === 'tool-group'
  ) {
    const row = out[existingGroupIdx] as Extract<Row, { kind: 'tool-group' }>;
    const children = row.children.slice();
    const prev = children[existingChildIdx]!;
    children[existingChildIdx] = {
      ...prev,
      call,
      partial: false,
      diffStream: undefined
    };
    out[existingGroupIdx] = { ...row, children };
    return;
  }

  const toolName = call.name;
  let groupIdx: number;
  const curIdx = state.openToolGroupIdx;
  const curRow = curIdx !== null ? out[curIdx] : undefined;
  if (!toolGroupMatchesScope(curRow, toolName, scopeId)) {
    out.push({
      kind: 'tool-group',
      key: `tg:${call.id}`,
      toolName,
      children: [],
      ...(scopeId ? { subagentId: scopeId } : {})
    });
    groupIdx = out.length - 1;
    state.openToolGroupIdx = groupIdx;
    state.openFileEditGroupIdx = null;
  } else {
    groupIdx = curIdx!;
  }
  const row = out[groupIdx] as Extract<Row, { kind: 'tool-group' }>;
  const children = [...row.children, { callId: call.id, call }];
  out[groupIdx] = { ...row, children };
  state.callIdToGroupIdx.set(call.id, groupIdx);
  state.callIdToChildIdx.set(call.id, children.length - 1);
}

export function foldToolResult(
  out: Row[],
  state: ScopedGroupState,
  result: ToolResult,
  subagentId?: string
): void {
  const scopeId = subagentId;
  const groupIdx = state.callIdToGroupIdx.get(result.id);
  const childIdx = state.callIdToChildIdx.get(result.id);
  if (
    groupIdx !== undefined &&
    childIdx !== undefined &&
    out[groupIdx]?.kind === 'tool-group'
  ) {
    const row = out[groupIdx] as Extract<Row, { kind: 'tool-group' }>;
    const children = row.children.slice();
    const prev = children[childIdx]!;
    children[childIdx] = { ...prev, result };
    out[groupIdx] = { ...row, children };
    return;
  }

  const toolName = result.name;
  let gIdx: number;
  const curIdx = state.openToolGroupIdx;
  const curRow = curIdx !== null ? out[curIdx] : undefined;
  if (!toolGroupMatchesScope(curRow, toolName, scopeId)) {
    out.push({
      kind: 'tool-group',
      key: `tg:${result.id}`,
      toolName,
      children: [],
      ...(scopeId ? { subagentId: scopeId } : {})
    });
    gIdx = out.length - 1;
    state.openToolGroupIdx = gIdx;
    state.openFileEditGroupIdx = null;
  } else {
    gIdx = curIdx!;
  }
  const row = out[gIdx] as Extract<Row, { kind: 'tool-group' }>;
  const children = [...row.children, { callId: result.id, result }];
  out[gIdx] = { ...row, children };
  state.callIdToGroupIdx.set(result.id, gIdx);
  state.callIdToChildIdx.set(result.id, children.length - 1);
}

export interface FileEditFoldInput {
  id: string;
  filePath: string;
  additions: number;
  deletions: number;
  entryId?: string;
}

export function foldScopedFileEdit(
  out: Row[],
  state: ScopedGroupState,
  edit: FileEditFoldInput,
  subagentId?: string
): void {
  const scopeId = subagentId;
  state.openToolGroupIdx = null;
  let groupIdx: number;
  const curIdx = state.openFileEditGroupIdx;
  const curRow = curIdx !== null ? out[curIdx] : undefined;
  if (!fileEditGroupMatchesScope(curRow, scopeId)) {
    out.push({
      kind: 'file-edit-group',
      key: `fe:${edit.id}`,
      children: [],
      ...(scopeId ? { subagentId: scopeId } : {})
    });
    groupIdx = out.length - 1;
    state.openFileEditGroupIdx = groupIdx;
  } else {
    groupIdx = curIdx!;
  }
  appendFileEditChild(out, groupIdx, edit);
}

function appendFileEditChild(out: Row[], groupIdx: number, edit: FileEditFoldInput): void {
  const row = out[groupIdx] as Extract<Row, { kind: 'file-edit-group' }>;
  const child: FileEditGroupChild = {
    key: edit.id,
    filePath: edit.filePath,
    additions: edit.additions,
    deletions: edit.deletions,
    ...(edit.entryId ? { entryId: edit.entryId } : {})
  };
  out[groupIdx] = { ...row, children: [...row.children, child] };
}

function mergeFileEditIntoEditToolGroupAt(
  out: Row[],
  groupIdx: number,
  edit: FileEditFoldInput
): boolean {
  const prior = out[groupIdx];
  if (!prior || prior.kind !== 'tool-group' || prior.toolName !== 'edit') return false;
  const lastIdx = prior.children.length - 1;
  const last = prior.children[lastIdx];
  const lastPath = editChildPath(last);
  if (!last || !last.result || !last.result.ok || lastPath !== edit.filePath) return false;
  const children = prior.children.slice();
  children[lastIdx] = {
    ...last,
    fileEditAdditions: (last.fileEditAdditions ?? 0) + edit.additions,
    fileEditDeletions: (last.fileEditDeletions ?? 0) + edit.deletions
  };
  out[groupIdx] = { ...prior, children };
  return true;
}

/**
 * Fold a `file-edit` event into the matching `edit` tool-group when the last
 * settled child targets the same path (orchestrator and sub-agent). Avoids
 * the duplicate "Edited path" tool-group + file-edit-group pair emitted for
 * every successful `edit` tool (three wire events, one UI row).
 *
 * Tries `openToolGroupIdx` first, then scans backward — group breakers such
 * as assistant-text between `tool-result` and `file-edit` clear the open
 * index but the edit group row is still in `out`.
 */
function tryMergeFileEditIntoEditToolGroup(
  out: Row[],
  state: ScopedGroupState,
  edit: FileEditFoldInput,
  subagentId?: string
): boolean {
  const scopeId = subagentId;
  if (state.openToolGroupIdx !== null) {
    const open = out[state.openToolGroupIdx];
    if (open?.kind === 'tool-group' && open.subagentId === scopeId) {
      if (mergeFileEditIntoEditToolGroupAt(out, state.openToolGroupIdx, edit)) {
        return true;
      }
    }
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const row = out[i];
    if (row.kind !== 'tool-group' || row.toolName !== 'edit' || row.subagentId !== scopeId) {
      continue;
    }
    if (mergeFileEditIntoEditToolGroupAt(out, i, edit)) {
      return true;
    }
  }
  return false;
}

/**
 * Orchestrator file-edit: merge into prior `edit` tool-group when possible;
 * otherwise fold into file-edit-group (bash mutations, path mismatch, etc.).
 */
export function foldOrchestratorFileEdit(
  out: Row[],
  state: ScopedGroupState,
  edit: FileEditFoldInput
): boolean {
  if (tryMergeFileEditIntoEditToolGroup(out, state, edit)) {
    return true;
  }
  foldScopedFileEdit(out, state, edit);
  return false;
}

/** Sub-agent scoped file-edit — same merge rules as orchestrator. */
export function foldSubagentFileEdit(
  out: Row[],
  state: ScopedGroupState,
  edit: FileEditFoldInput,
  subagentId: string
): boolean {
  if (tryMergeFileEditIntoEditToolGroup(out, state, edit, subagentId)) {
    return true;
  }
  foldScopedFileEdit(out, state, edit, subagentId);
  return false;
}
