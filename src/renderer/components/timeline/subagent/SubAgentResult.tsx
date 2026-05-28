/**
 * Parses and renders the sub-agent's final `<result>…</result>` envelope.
 *
 * Audit fix §1.2:
 *   - Uses the shared `parseResultEnvelope` so the host's verifier and
 *     this renderer can never disagree about what the worker emitted.
 *   - When no `<result>` envelope is found, renders a single muted
 *     empty-state line instead of dumping the raw worker text. The
 *     worker's own status (`SubAgentHeader` / `SubAgentSnapshot.message`)
 *     already explains the failure mode — dumping the raw body here
 *     would just duplicate that signal under a misleading
 *     `result (raw)` label.
 *   - Renders the raw body only as an explicit fallback when the
 *     worker emitted SOME content but no envelope, surfacing it under
 *     a `worker output (no envelope)` label so the user understands
 *     the absence is the worker's fault, not the renderer's.
 */

import { DetailPane } from '../tools/shared/DetailPane.js';
import { CodeBlock } from '../tools/shared/CodeBlock.js';
import { MarkdownBody } from '../markdown/MarkdownBody.js';
import { parseResultEnvelope, type ParsedResultEnvelope } from '@shared/text/resultPatterns.js';
import { chromeStatusPillClassName } from '../../ui/SurfaceShell.js';

interface SubAgentResultProps {
  output: string;
  /** When true, the artifacts block is omitted (rendered elsewhere). */
  omitArtifacts?: boolean;
  /** Pre-parsed envelope — avoids duplicate parsing when the parent already has it. */
  parsed?: ParsedResultEnvelope;
}

function extractSection(inner: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(inner);
  return m ? (m[1] ?? '').trim() : undefined;
}

export function SubAgentResult({
  output,
  omitArtifacts = false,
  parsed: parsedProp
}: SubAgentResultProps) {
  const trimmed = output.trim();
  const parsed = parsedProp ?? parseResultEnvelope(output);
  if (!parsed.found) {
    // No `<result>` envelope. The verifier classified this as
    // `malformed`. Two sub-cases:
    //   1. The worker emitted SOME body — surface it raw under an
    //      honest label so the user can see what the worker
    //      actually produced.
    //   2. The worker emitted nothing at all (the
    //      `hasNothingToWrap` early-out in `SubAgent.ts`, or an
    //      aborted run that was promoted to the Result tab by the
    //      always-show rule in `SubAgentDetailTabs`). Render a
    //      muted explainer instead of an empty `<CodeBlock>` so
    //      the pane reads as "nothing was captured" rather than
    //      "here is empty content".
    if (trimmed.length === 0) {
      return (
        <DetailPane label="sub-agent output (no envelope)">
          <span className="text-row leading-relaxed text-text-muted">
            No output captured from the worker — see the red status row
            above for the failure reason.
          </span>
        </DetailPane>
      );
    }
    return (
      <DetailPane label="sub-agent output (no envelope)">
        <CodeBlock body={trimmed} />
      </DetailPane>
    );
  }
  const inner = parsed.inner;
  const status = parsed.status ?? undefined;
  const summary = parsed.summary.length > 0 ? parsed.summary : undefined;
  const details = extractSection(inner, 'details');
  const artifacts = omitArtifacts ? undefined : extractSection(inner, 'artifacts');
  return (
    <div className="flex flex-col gap-2">
      {status && (
        <div className="flex items-center gap-2 text-row">
          <span className="text-text-faint">status</span>
          <span
            className={chromeStatusPillClassName(
              status === 'success'
                ? 'success'
                : status === 'partial'
                  ? 'warning'
                  : 'danger'
            )}
          >
            {status}
          </span>
        </div>
      )}
      {summary && (
        <DetailPane label="summary">
          <MarkdownBody text={summary} className="text-row leading-relaxed text-text-secondary" />
        </DetailPane>
      )}
      {details && (
        <DetailPane label="details">
          <MarkdownBody text={details} className="text-row leading-relaxed text-text-secondary" />
        </DetailPane>
      )}
      {artifacts && (
        <DetailPane label="artifacts">
          {/* `CodeBlock` mirrors the no-envelope fallback above and
              the `EditInvocation` `created content` pane, so all three
              code-flavored result surfaces share one renderer (with
              the inline copy affordance for free). */}
          <CodeBlock body={artifacts} tone="muted" />
        </DetailPane>
      )}
    </div>
  );
}
