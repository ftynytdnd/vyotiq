/**
 * Internal tool interface. Each tool exports a `Tool` object that the
 * registry pulls in. Tools never see plaintext API keys, only the workspace
 * sandbox + a permissions object.
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import type { ChatPermissions, TimelineEvent } from '@shared/types/chat.js';
import type { EditApprovalPayload } from '@shared/types/ipc.js';
import type { ConfirmReason } from '../orchestrator/confirmBus.js';

/**
 * Outcome of a `ctx.confirm` round-trip. `approved` is the gate;
 * `reason` distinguishes the four ways `approved: false` can arise so
 * tools can render a precise failure message to the model + user
 * instead of always saying "user denied". Audit fix H-04.
 */
export interface ConfirmOutcome {
  approved: boolean;
  reason: ConfirmReason;
}

/**
 * Map a non-approved `ConfirmOutcome.reason` into the
 * `(output, error)` pair tools surface in their `ToolResult`. Keeps
 * the failure-message wording consistent across tools so the model
 * sees a stable surface and the user sees something honest:
 *
 *   - `'denied'`  → "User denied permission …"
 *   - `'timeout'` → "Permission prompt timed out …"
 *   - `'aborted'` → "Permission prompt aborted (user pressed Stop)…"
 *   - `'no-ui'`   → "Host could not show the permission prompt…"
 *
 * `verb` is the tool-action description that goes in the message
 * (`"run shell command"`, `"modify foo.ts"`, `"delete bar"`, etc.).
 * Audit fix H-04.
 */
export function describeConfirmFailure(
  reason: ConfirmReason,
  verb: string
): { output: string; error: string } {
  switch (reason) {
    case 'denied':
      return {
        output: `User denied permission to ${verb}.`,
        error: 'permission denied'
      };
    case 'timeout':
      return {
        output: `Permission prompt for "${verb}" timed out without a user reply.`,
        error: 'permission prompt timeout'
      };
    case 'aborted':
      return {
        output: `Permission prompt for "${verb}" was aborted (run cancelled before the user replied).`,
        error: 'permission prompt aborted'
      };
    case 'no-ui':
      return {
        output: `Host could not show the permission prompt for "${verb}" (no live window). The action was NOT performed.`,
        error: 'no-ui'
      };
    case 'approved':
      // Defensive fallthrough — callers should only reach this helper
      // on the non-approved path.
      return { output: `Approved.`, error: '' };
  }
}

/** Per-call execution context handed to every tool. */
export interface ToolContext {
  /** Absolute path of the active workspace. All tool paths must resolve inside this. */
  workspacePath: string;
  /**
   * Workspace id (registry id, not path). Required for the checkpoint
   * store so snapshots land under the right per-workspace folder
   * regardless of which workspace is globally active at the moment.
   */
  workspaceId: string;
  /** Run id (orchestrator-assigned). Used to thread changes into the run manifest. */
  runId: string;
  /** Conversation id that owns the run. Used by the pending-change registry. */
  conversationId: string;
  /** Permissions for this run. */
  permissions: ChatPermissions;
  /**
   * Strict-approval mode for this run's workspace. When `true`, file-
   * mutating tools (`edit`, `delete`) must always request explicit
   * `ctx.confirm` approval with a full diff payload before applying.
   * When `false` (default), tools apply optimistically and the change
   * surfaces as a pending entry the user can Accept/Reject post-hoc.
   * Read from `AppSettings.ui.strictApprovalsByWorkspace[workspaceId]`.
   */
  strictApprovals: boolean;
  /** Abort signal for the entire run — tools should respect this. */
  signal: AbortSignal;
  /**
   * Asks the user for confirmation. Returns `{ approved, reason }`
   * (audit fix H-04). `reason` is `'approved'` on accept, `'denied'`
   * on a real user click, and one of `'timeout' | 'aborted' | 'no-ui'`
   * for the host-side fail-closed paths so the calling tool can
   * surface a precise failure message — "host could not show the
   * prompt" / "timed out" / "aborted" instead of always "user denied".
   * Used for destructive operations (bash destructive patterns,
   * allow-bash gate, etc.) where a plain "Allow?" prompt is enough.
   */
  confirm(message: string): Promise<ConfirmOutcome>;
  /**
   * Richer approval flow for file mutations. Used by `edit` / `delete`
   * (and bash-mutation recovery may opt in later). The renderer
   * mounts a full-diff dialog so the user can see exactly what will
   * change before approving.
   *
   * Returns `{ approved, acceptAllRemaining }`:
   *   - `approved`            — gate; identical semantics to `confirm`.
   *   - `acceptAllRemaining`  — `true` only if the user pressed the
   *                              "Accept all remaining in this run"
   *                              button. The orchestrator latches this
   *                              into a per-run flag (`autoAcceptEditApprovals`)
   *                              so further `edit`/`delete` calls in the
   *                              same run skip the prompt.
   */
  confirmEdit(payload: EditApprovalPayload): Promise<{
    approved: boolean;
    acceptAllRemaining: boolean;
  }>;
  /** Emit a `TimelineEvent` for the renderer. Used by checkpoint integration. */
  emit: (event: TimelineEvent) => void;
  /** Optional: emit a free-form progress line for the timeline. */
  progress?: (message: string) => void;
  /** Subagent id, when running inside a sub-agent. */
  subagentId?: string;
}

export interface Tool {
  /** Tool name as the LLM sees it. */
  name: ToolName;
  /** OpenAI-compat function schema, used in `tools` request body. */
  schema: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  /** Plain English brief — fed into the harness for the model. */
  briefMarkdown: string;
  /** Executes the tool. Must NEVER throw — convert errors into ToolResult. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
