/**
 * Internal tool interface. Each tool exports a `Tool` object that the
 * registry pulls in. Tools never see plaintext API keys, only the workspace
 * workspace sandbox.
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import type { TimelineEvent } from '@shared/types/chat.js';

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
  /** Abort signal for the entire run — tools should respect this. */
  signal: AbortSignal;
  /** Emit a `TimelineEvent` for the renderer. Used by checkpoint integration. */
  emit: (event: TimelineEvent) => void;
  /** Originating tool-call id — required for live output telemetry. */
  toolCallId?: string;
  /** Optional: emit a free-form progress line for the timeline. */
  progress?: (message: string) => void;
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
