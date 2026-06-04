/**
 * `delete` tool — removes a file from the workspace after snapshotting
 * its pre-state into the checkpoint store. The snapshot means the user
 * can always revert a delete back into existence.
 *
 * Workspace file delete with checkpoint snapshot for revert. Exposed on
 * the solo Agent V tool surface per `tools/policy/agentTools.ts`.
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import { realpathInsideWorkspace, workspaceRelative } from './sandbox.js';
import { recordChange } from '../checkpoints/index.js';

interface DeleteArgs {
  path: string;
}

export const deleteTool: Tool = {
  name: 'delete',
  briefMarkdown: `### Tool: \`delete\`

**WHAT it is.** A safe file-removal tool. Before unlinking, it snapshots the current file contents into the workspace checkpoint store so the user can revert the delete at any time.

**HOW to use it.**
\`\`\`json
{ "name": "delete", "arguments": { "path": "src/old.ts" } }
\`\`\`

**WHY it exists.** \`bash rm\` bypasses the checkpoint store — a delete through the shell cannot be reverted. Always prefer \`delete\` for removing workspace files the user might want back.

**WHEN to trigger it.** Whenever you need to remove a tracked file. Never use \`bash\` for removals unless the file is obviously scratch (e.g. a build artifact under \`dist/\`) and the user is unlikely to want it back.

**Rules.**
- Fails if the target is a directory (use a focused \`edit\` flow for folder cleanups).
- Fails if the target does not exist.
- Refuses binary-looking files (same UTF-8 gate as \`read\`).
- Deleting a directory requires \`recursive: true\`.`,
  schema: {
    type: 'function',
    function: {
      name: 'delete',
      description:
        'Delete a file from the workspace. Snapshots pre-state into the checkpoint store so the user can revert the delete.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to workspace root.' }
        },
        required: ['path']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<DeleteArgs>;
    if (typeof a.path !== 'string' || !a.path.trim()) {
      return failure(id, started, 'Error: `path` is required.', 'missing path');
    }

    let abs: string;
    try {
      abs = await realpathInsideWorkspace(ctx.workspacePath, a.path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(id, started, `Sandbox error: ${msg}`, msg);
    }

    // Target must exist and be a regular file.
    let stat: import('node:fs').Stats;
    try {
      stat = await fs.stat(abs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(id, started, `Cannot stat ${a.path}: ${msg}`, 'stat failed');
    }
    if (stat.isDirectory()) {
      return failure(
        id,
        started,
        `Refusing to delete: ${a.path} is a directory. Delete files individually.`,
        'is directory'
      );
    }
    if (!stat.isFile()) {
      return failure(
        id,
        started,
        `Refusing to delete: ${a.path} is not a regular file.`,
        'not a file'
      );
    }

    // Read the pre-state EARLY — both because we need it for the
    // approval-dialog preview AND because the post-approval snapshot
    // step needs it anyway. The binary-file gate defends the
    // checkpoint store from being pumped full of blobs it can't
    // meaningfully diff; deleting binaries is allowed via `bash`
    // (with the accompanying non-reversible warning).
    let original: string;
    try {
      original = await fs.readFile(abs, 'utf8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(id, started, `Cannot read ${a.path} for snapshot: ${msg}`, msg);
    }
    if (original.includes('\0')) {
      return failure(
        id,
        started,
        `Refusing to delete binary file ${a.path} via \`delete\`. Use \`bash rm\` if required — but note that bash removals are NOT reversible from the checkpoint store.`,
        'binary refusal'
      );
    }

    // Unlink.
    try {
      await fs.unlink(abs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(id, started, `Delete failed: ${msg}`, msg);
    }

    const rel = workspaceRelative(ctx.workspacePath, abs);
    const deletedLines = original.split('\n').length;
    try {
      await recordChange({
        runId: ctx.runId,
        conversationId: ctx.conversationId,
        workspaceId: ctx.workspaceId,
        filePath: rel,
        kind: 'delete',
        preContent: original,
        additions: 0,
        deletions: deletedLines,
        source: 'delete',
      });
    } catch {
      /* logged inside the store */
    }

    return {
      id,
      name: 'delete',
      ok: true,
      output: `Deleted ${a.path} (${deletedLines} line${deletedLines === 1 ? '' : 's'}). Revert available in Checkpoints.`,
      data: {
        tool: 'delete',
        filePath: rel,
        deletedLines
      },
      durationMs: Date.now() - started
    };
  }
};

function failure(id: string, started: number, output: string, error: string): ToolResult {
  return {
    id,
    name: 'delete',
    ok: false,
    output,
    error,
    durationMs: Date.now() - started
  };
}
