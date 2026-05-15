/**
 * Internal tool interface. Each tool exports a `Tool` object that the
 * registry pulls in. Tools never see plaintext API keys, only the workspace
 * sandbox + a permissions object.
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import type { ChatPermissions, TimelineEvent } from '@shared/types/chat.js';
import type { EditApprovalPayload } from '@shared/types/ipc.js';

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
   * Asks the user for confirmation. Returns true if approved. Used for
   * destructive operations (bash destructive patterns, allow-bash
   * gate, etc.) where a plain "Allow?" prompt is enough.
   */
  confirm(message: string): Promise<boolean>;
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
