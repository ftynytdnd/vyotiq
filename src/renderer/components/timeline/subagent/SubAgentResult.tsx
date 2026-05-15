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
import { parseResultEnvelope } from '@shared/text/resultPatterns.js';
import { cn } from '../../../lib/cn.js';

interface SubAgentResultProps {
  output: string;
}

function extractSection(inner: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(inner);
  return m ? (m[1] ?? '').trim() : undefined;
}

export function SubAgentResult({ output }: SubAgentResultProps) {
  const parsed = parseResultEnvelope(output);
  if (!parsed.found) {
    // No `<result>` envelope. The verifier classified this as
    // `malformed`; surface the raw output under an honest label so
    // the user can see what the worker actually produced. The
    // empty-output case is already filtered upstream by
    // `SubAgentTrace`'s `hasOutput` gate (audit fix A3 — that branch
    // was unreachable here and was removed).
    return (
      <DetailPane label="sub-agent output (no envelope)">
        <CodeBlock body={output.trim()} />
      </DetailPane>
    );
  }
  const inner = parsed.inner;
  const status = parsed.status ?? undefined;
  const summary = parsed.summary.length > 0 ? parsed.summary : undefined;
  const details = extractSection(inner, 'details');
  const artifacts = extractSection(inner, 'artifacts');
  return (
    <div className="flex flex-col gap-2">
      {status && (
        <div className="flex items-center gap-2 text-row">
          <span className="text-text-faint">status</span>
          <span
            className={cn(
              'rounded-inner px-1.5 py-0.5 text-meta font-medium capitalize',
              status === 'success'
                ? 'bg-success/10 text-success'
                : status === 'partial'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-danger/10 text-danger'
            )}
          >
            {status}
          </span>
        </div>
      )}
      {summary && (
        <DetailPane label="summary">
          <MarkdownBody text={summary} className="text-log leading-relaxed text-text-secondary" />
        </DetailPane>
      )}
      {details && (
        <DetailPane label="details">
          <MarkdownBody text={details} className="text-log leading-relaxed text-text-secondary" />
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
