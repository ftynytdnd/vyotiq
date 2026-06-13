/**
 * Open a workspace-relative path in the in-app editor when supported.
 */

import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';
import { useEditorStore } from '../store/useEditorStore.js';
import { useWorkspaceStore } from '../store/useWorkspaceStore.js';

export interface OpenWorkspaceFileInEditorOpts {
  workspaceId?: string;
  initialContent?: string;
  initialMtimeMs?: number;
}

export function canOpenInAppEditor(filePath: string): boolean {
  return isEditableTextFile(filePath);
}

export async function openWorkspaceFileInEditor(
  filePath: string,
  opts: OpenWorkspaceFileInEditorOpts = {}
): Promise<boolean> {
  if (!canOpenInAppEditor(filePath)) return false;
  const workspaceId = opts.workspaceId ?? useWorkspaceStore.getState().activeId ?? undefined;
  await useEditorStore.getState().openFile(filePath, {
    ...(workspaceId ? { workspaceId } : {}),
    ...(opts.initialContent !== undefined ? { initialContent: opts.initialContent } : {}),
    ...(opts.initialMtimeMs !== undefined ? { initialMtimeMs: opts.initialMtimeMs } : {})
  });
  return useEditorStore.getState().open;
}
