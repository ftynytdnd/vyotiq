/**
 * Live stdout/stderr panes for in-flight bash invocations.
 */

import type { LiveToolOutputSnapshot } from '../../reducer/types.js';
import { useLiveElapsedMs, formatLiveElapsedMs } from '../../../../hooks/useLiveElapsedMs.js';
import { DetailPane } from './DetailPane.js';
import { CodeBlock } from './CodeBlock.js';
import {
  formatTerminalDisplay,
  hasVisibleTerminalOutput
} from '@shared/text/terminalDisplayText.js';

interface BashLiveOutputSectionProps {
  liveOutput?: LiveToolOutputSnapshot;
  /** Wall-clock anchor when live telemetry has not arrived yet. */
  startedAt?: number;
  active: boolean;
}

export function BashLiveOutputSection({
  liveOutput,
  startedAt,
  active
}: BashLiveOutputSectionProps) {
  const liveElapsed = formatLiveElapsedMs(useLiveElapsedMs(startedAt, active));

  if (!active) return null;

  const stdout = liveOutput?.stdout ?? '';
  const stderr = liveOutput?.stderr ?? '';
  const stdoutVisible = hasVisibleTerminalOutput(stdout);
  const stderrVisible = hasVisibleTerminalOutput(stderr);
  const waiting = !stdoutVisible && !stderrVisible;
  const displayStdout = formatTerminalDisplay(stdout);
  const displayStderr = formatTerminalDisplay(stderr);

  return (
    <>
      {waiting ? (
        <DetailPane label={`stdout (live · ${liveElapsed})`}>
          <div className="vx-bash-live-waiting vx-bash-live-waiting--pulse" aria-live="polite">
            Waiting for output…
          </div>
        </DetailPane>
      ) : null}
      {stdoutVisible ? (
        <DetailPane
          label={
            liveOutput?.stdoutTruncated
              ? `stdout (live · ${liveElapsed}, truncated)`
              : `stdout (live · ${liveElapsed})`
          }
        >
          <CodeBlock body={displayStdout} />
        </DetailPane>
      ) : null}
      {stderrVisible ? (
        <DetailPane
          label={
            liveOutput?.stderrTruncated
              ? `stderr (live · ${liveElapsed}, truncated)`
              : `stderr (live · ${liveElapsed})`
          }
          tone="danger"
        >
          <CodeBlock body={displayStderr} tone="danger" />
        </DetailPane>
      ) : null}
    </>
  );
}
