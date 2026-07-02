/**
 * Shared tool-group / file-edit-group folding for the timeline deriver.
 */

import type { DiffHunk, ToolCall, ToolName, ToolResult } from '@shared/types/tool.js';
import type { Row, ToolGroupChild } from '../deriveRows.js';
import { editChildPath } from './groupTools.js';

export interface ScopedGroupState {
  openToolGroupIdx: number | null;
  callIdToGroupIdx: Map<string, number>;
  callIdToChildIdx: Map<string, number>;
}

function toolGroupMatches(
  row: Row | undefined,
  toolName: ToolName
): row is Extract<Row, { kind: 'tool-group' }> {
  return !!row && row.kind === 'tool-group' && row.toolName === toolName;
}

function withEditRetryCount(
  children: ToolGroupChild[],
  childIdx: number,
  child: ToolGroupChild
): ToolGroupChild {
  if (child.result?.name !== 'edit' || child.result.ok) return child;
  const path = editChildPath(child);
  if (!path) return child;
  const prev = childIdx > 0 ? children[childIdx - 1] : undefined;
  if (
    prev?.result &&
    !prev.result.ok &&
    prev.result.name === 'edit' &&
    editChildPath(prev) === path
  ) {
    return { ...child, retryCount: (prev.retryCount ?? 1) + 1 };
  }
  return child;
}

function mergeToolResultChild(
  children: ToolGroupChild[],
  childIdx: number,
  result: ToolResult
): ToolGroupChild {
  const prev = children[childIdx]!;
  return withEditRetryCount(children, childIdx, { ...prev, result });
}

export function foldToolCall(out: Row[], state: ScopedGroupState, call: ToolCall): void {
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
  if (!toolGroupMatches(curRow, toolName)) {
    out.push({
      kind: 'tool-group',
      key: `tg:${call.id}`,
      toolName,
      children: []
    });
    groupIdx = out.length - 1;
    state.openToolGroupIdx = groupIdx;
  } else {
    groupIdx = curIdx!;
  }
  const row = out[groupIdx] as Extract<Row, { kind: 'tool-group' }>;
  const children = [...row.children, { callId: call.id, call }];
  out[groupIdx] = { ...row, children };
  state.callIdToGroupIdx.set(call.id, groupIdx);
  state.callIdToChildIdx.set(call.id, children.length - 1);
}

export function foldToolResult(out: Row[], state: ScopedGroupState, result: ToolResult): void {
  const groupIdx = state.callIdToGroupIdx.get(result.id);
  const childIdx = state.callIdToChildIdx.get(result.id);
  if (
    groupIdx !== undefined &&
    childIdx !== undefined &&
    out[groupIdx]?.kind === 'tool-group'
  ) {
    const row = out[groupIdx] as Extract<Row, { kind: 'tool-group' }>;
    const children = row.children.slice();
    children[childIdx] = mergeToolResultChild(children, childIdx, result);
    out[groupIdx] = { ...row, children };
    return;
  }

  const toolName = result.name;
  let gIdx: number;
  const curIdx = state.openToolGroupIdx;
  const curRow = curIdx !== null ? out[curIdx] : undefined;
  if (!toolGroupMatches(curRow, toolName)) {
    out.push({
      kind: 'tool-group',
      key: `tg:${result.id}`,
      toolName,
      children: []
    });
    gIdx = out.length - 1;
    state.openToolGroupIdx = gIdx;
  } else {
    gIdx = curIdx!;
  }
  const row = out[gIdx] as Extract<Row, { kind: 'tool-group' }>;
  const children = [...row.children, { callId: result.id, result }];
  const newChildIdx = children.length - 1;
  children[newChildIdx] = withEditRetryCount(children, newChildIdx, children[newChildIdx]!);
  out[gIdx] = { ...row, children };
  state.callIdToGroupIdx.set(result.id, gIdx);
  state.callIdToChildIdx.set(result.id, newChildIdx);
}

export interface FileEditFoldInput {
  id: string;
  filePath: string;
  additions: number;
  deletions: number;
  entryId?: string;
  hunks?: DiffHunk[];
}

export function foldScopedFileEdit(
  out: Row[],
  state: ScopedGroupState,
  edit: FileEditFoldInput
): void {
  state.openToolGroupIdx = null;
  out.push({
    kind: 'file-edit-card',
    key: `fec:${edit.id}`,
    callId: edit.id,
    filePath: edit.filePath,
    additions: edit.additions,
    deletions: edit.deletions,
    ...(edit.entryId ? { entryId: edit.entryId } : {}),
    ...(edit.hunks && edit.hunks.length > 0 ? { hunks: edit.hunks } : {}),
    phase: 'settled'
  });
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

function tryMergeFileEditIntoEditToolGroup(
  out: Row[],
  state: ScopedGroupState,
  edit: FileEditFoldInput
): boolean {
  if (state.openToolGroupIdx !== null) {
    const open = out[state.openToolGroupIdx];
    if (open?.kind === 'tool-group') {
      if (mergeFileEditIntoEditToolGroupAt(out, state.openToolGroupIdx, edit)) {
        return true;
      }
    }
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const row = out[i];
    if (row.kind !== 'tool-group' || row.toolName !== 'edit') {
      continue;
    }
    if (mergeFileEditIntoEditToolGroupAt(out, i, edit)) {
      return true;
    }
  }
  return false;
}

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
