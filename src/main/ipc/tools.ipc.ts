/**
 * Tools IPC. Small renderer helpers (open file in OS).
 */

import { shell } from 'electron';
import { IPC } from '@shared/constants.js';
import { clipRunSummaryPromptPreview } from '@shared/report/deliverables.js';
import type { GenerateRunSummaryInput } from '@shared/types/ipc.js';
import { generateRunSummaryReport } from '../tools/runSummaryReport.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import {
  requireWorkspace,
  requireWorkspaceById
} from '../workspace/workspaceState.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertObject,
  assertOptionalString,
  assertString
} from './validate.js';

const log = logger.child('ipc/tools');

const MAX_RELATIVE_PATH_BYTES = 4096;

export function registerToolsIpc(): void {
  // `workspaceId` is optional; when supplied, the path is resolved
  // against THAT workspace's root rather than the active workspace's.
  // The report card threads it through whenever it knows which
  // workspace owns the file so an "open externally" click never
  // silently lands on a different workspace's same-relative path
  // after the active workspace has drifted.
  wrapIpcHandler(IPC.TOOLS_OPEN_PATH, async (_event, path: string, workspaceId?: string) => {
    assertString('tools:openPath', 'path', path, { maxBytes: MAX_RELATIVE_PATH_BYTES });
    assertOptionalString('tools:openPath', 'workspaceId', workspaceId);
    const ws = workspaceId
      ? await requireWorkspaceById(workspaceId)
      : await requireWorkspace();
    // Symlink-aware containment check. The lexical `isInsideWorkspace`
    // pre-check used here previously let a workspace-rooted symlink
    // (`vendor -> /etc`) redirect `shell.openPath` at an arbitrary OS
    // file — the lexical resolution stayed inside the sandbox even
    // though the canonicalised target did not. `realpathInsideWorkspace`
    // follows every symlink on the path and rejects targets that
    // escape the workspace; it falls back to the lexical resolution
    // for paths that don't yet exist (ENOENT), which is fine because
    // `shell.openPath` then surfaces its own user-facing error.
    let abs: string;
    try {
      abs = await realpathInsideWorkspace(ws, path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('refused to open path outside workspace', { path, err: msg });
      throw new Error(msg);
    }
    const result = await shell.openPath(abs);
    if (result) {
      // Non-empty string from shell.openPath signals a failure.
      log.warn('shell.openPath failed', { path: abs, message: result });
      throw new Error(result);
    }
  });

  wrapIpcHandler(
    IPC.REPORTS_GENERATE_RUN_SUMMARY,
    async (_event, input: GenerateRunSummaryInput) => {
      assertObject('reports:generate-run-summary', 'input', input);
      assertString('reports:generate-run-summary', 'conversationId', input.conversationId);
      assertString('reports:generate-run-summary', 'workspaceId', input.workspaceId);
      assertString('reports:generate-run-summary', 'promptId', input.promptId);
      if (typeof input.promptPreview !== 'string') {
        throw new Error('reports:generate-run-summary: promptPreview must be a string');
      }
      const promptPreview = clipRunSummaryPromptPreview(input.promptPreview);
      assertString('reports:generate-run-summary', 'promptPreview', promptPreview);
      if (!Array.isArray(input.edits) || input.edits.length === 0) {
        throw new Error('reports:generate-run-summary: edits must be a non-empty array');
      }
      const ws = await requireWorkspaceById(input.workspaceId);
      const result = await generateRunSummaryReport({ ...input, promptPreview }, ws);
      if (!result.ok || !result.data || result.data.tool !== 'report') {
        return { ok: false as const, error: result.error ?? result.output };
      }
      return {
        ok: true as const,
        title: result.data.title,
        relPath: result.data.relPath,
        bytes: result.data.bytes
      };
    }
  );
}
