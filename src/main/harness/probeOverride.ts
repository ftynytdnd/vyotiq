/**
 * Best-effort probe for `<workspacePath>/.vyotiq/context-summarizer.md`.
 *
 * Shared helper consumed by:
 *   - `runLoop.runHandle.snapshot()` — surfaces the result into
 *     `ContextInspectorSnapshot.workspaceOverridePresent` so the
 *     Inspector can render a small "Workspace override" badge.
 *   - `contextSummary.ipc.snapshotForIdleConversation` — same use
 *     for the idle-conversation path.
 *
 * Mirrors the predicate `harnessLoader.resolveSummarizerBody` uses
 * to decide whether to ship the override body to the summarizer
 * LLM, so the Inspector's badge agrees with what the summarizer
 * actually receives.
 *
 * Extraction rationale (review finding M2): two copies of the same
 * routine had drifted across `contextSummary.ipc.ts` and
 * `runLoop.ts`. The latter additionally used dynamic imports of
 * `node:fs`, `node:path`, and `@shared/constants.js` on every
 * call — wasteful given the Inspector polls this on every refresh.
 * Centralising both call sites here keeps the implementation
 * single-source-of-truth and the imports at module load time.
 *
 * Cheap: one `stat` + (when present) one small `readFile`. Any
 * filesystem error short-circuits to `false` rather than surfacing
 * an exception — a transient FS hiccup must not corrupt the
 * snapshot.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  CONTEXT_SUMMARY_OVERRIDE_FILENAME,
  WORKSPACE_DOTDIR
} from '@shared/constants.js';

export async function probeWorkspaceOverridePresent(
  workspacePath: string | undefined
): Promise<boolean> {
  if (!workspacePath || workspacePath.length === 0) return false;
  const overridePath = join(
    workspacePath,
    WORKSPACE_DOTDIR,
    CONTEXT_SUMMARY_OVERRIDE_FILENAME
  );
  try {
    const st = await fs.stat(overridePath);
    if (!st.isFile() || st.size === 0) return false;
    const raw = await fs.readFile(overridePath, 'utf8');
    return raw.trim().length > 0;
  } catch {
    return false;
  }
}
