import { realpathInsideWorkspace, workspaceRelative } from '../tools/sandbox.js';

export type AttachmentInWorkspace =
  | { inWorkspace: true; workspacePath: string; absPath: string }
  | { inWorkspace: false };

/**
 * True when `sourcePath` is contained in `workspaceRoot` (lexical + realpath).
 * Used for attachment ingest metadata — reads still go through sandbox separately.
 */
export async function resolveAttachmentInWorkspace(
  workspaceRoot: string,
  sourcePath: string
): Promise<AttachmentInWorkspace> {
  try {
    const abs = await realpathInsideWorkspace(workspaceRoot, sourcePath);
    return {
      inWorkspace: true,
      workspacePath: workspaceRelative(workspaceRoot, abs),
      absPath: abs
    };
  } catch {
    return { inWorkspace: false };
  }
}
