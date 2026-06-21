/**
 * Per-conversation heartbeat — periodic wake prompts for async loop work.
 */

import type { ModelSelection } from './provider.js';

export interface ConversationHeartbeat {
  conversationId: string;
  workspaceId: string;
  enabled: boolean;
  /** Poll interval — clamped to 5–10 minutes at attach time. */
  intervalMinutes: number;
  wakePrompt: string;
  selection: ModelSelection;
  lastWakeAt?: number;
  nextWakeAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface HeartbeatAttachInput {
  conversationId: string;
  workspaceId: string;
  intervalMinutes: number;
  wakePrompt?: string;
  selection: ModelSelection;
}

export interface HeartbeatDetachInput {
  conversationId: string;
}
