/**
 * Scheduled run record — local interval-based agent prompts.
 */

export interface ScheduledRun {
  id: string;
  enabled: boolean;
  label: string;
  workspaceId: string;
  conversationId: string;
  prompt: string;
  providerId: string;
  modelId: string;
  /** Minimum 5 minutes between runs. */
  intervalMinutes: number;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledRunInput {
  id?: string;
  enabled: boolean;
  label: string;
  workspaceId: string;
  conversationId: string;
  prompt: string;
  providerId: string;
  modelId: string;
  intervalMinutes: number;
}
