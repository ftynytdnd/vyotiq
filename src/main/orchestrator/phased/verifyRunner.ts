/**
 * Host acceptance-test runner for VERIFY phase.
 */

import { ensureWorkspacePty, runAgentCommandInPty } from '../../terminal/ptyManager.js';
import { PHASE_VERIFY_TIMEOUT_MS } from '@shared/constants.js';
import type { AcceptanceRunEvidence } from '@shared/types/phased.js';

export interface VerifyRunResult {
  evidence: AcceptanceRunEvidence[];
  allPassed: boolean;
  blocked: boolean;
  blockedReason?: string;
}

export async function runAcceptanceCommands(
  workspaceId: string,
  workspacePath: string,
  commands: string[],
  signal?: AbortSignal,
  timeoutMs: number = PHASE_VERIFY_TIMEOUT_MS
): Promise<VerifyRunResult> {
  if (commands.length === 0) {
    return {
      evidence: [],
      allPassed: false,
      blocked: false
    };
  }

  ensureWorkspacePty(workspaceId, workspacePath);
  const evidence: AcceptanceRunEvidence[] = [];
  let blocked = false;
  let blockedReason: string | undefined;

  for (const command of commands) {
    const trimmed = command.trim();
    if (!trimmed) continue;
    const result = await runAgentCommandInPty(
      workspaceId,
      trimmed,
      timeoutMs,
      signal
    );
    if (!result) {
      blocked = true;
      blockedReason = 'PTY session unavailable — cannot run acceptance tests';
      evidence.push({
        command: trimmed,
        exitCode: 1,
        output: blockedReason,
        timedOut: false
      });
      break;
    }
    evidence.push({
      command: trimmed,
      exitCode: result.exitCode,
      output: result.output,
      timedOut: result.timedOut
    });
    if (result.timedOut || result.exitCode !== 0) {
      break;
    }
  }

  const allPassed =
    !blocked &&
    evidence.length > 0 &&
    evidence.every((e) => !e.timedOut && e.exitCode === 0);

  return { allPassed, evidence, blocked, blockedReason };
}
