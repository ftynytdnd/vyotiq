/**
 * Default wake prompt injected by the host on heartbeat ticks.
 */

export const DEFAULT_HEARTBEAT_WAKE_PROMPT = `<heartbeat_wake>
Periodic status check for this thread.

Before acting:
1. Read <run_progress>, recent transcript, and workspace/git state (bash/gh when relevant).
2. Detect external changes (new PR, new HEAD SHA, CI failures).
3. If work remains: audit your last changes, fix gaps, or continue the task.
4. If blocked on a human decision: ask_user — do not guess.
5. If fully done: detach heartbeat and finish with a clear summary.

Do not repeat completed work. If identical tools ran in the last 10 minutes, continue from \`<run_progress>\` instead of re-reading the same files.

Human oversight remains.
</heartbeat_wake>`;
