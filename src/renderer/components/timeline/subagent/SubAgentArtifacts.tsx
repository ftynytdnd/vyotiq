/**
 * Renders the `<artifacts>` section from a sub-agent `<result>` envelope.
 */

import { DetailPane } from '../tools/shared/DetailPane.js';
import { CodeBlock } from '../tools/shared/CodeBlock.js';
import { parseResultEnvelope, type ParsedResultEnvelope } from '@shared/text/resultPatterns.js';

function extractSection(inner: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(inner);
  return m ? (m[1] ?? '').trim() : undefined;
}

interface SubAgentArtifactsProps {
  /** Pre-parsed envelope from the parent tab shell. */
  parsed: ParsedResultEnvelope;
}

export function SubAgentArtifacts({ parsed }: SubAgentArtifactsProps) {
  if (!parsed.found) return null;
  const artifacts = extractSection(parsed.inner, 'artifacts');
  if (!artifacts) return null;

  return (
    <DetailPane label="artifacts">
      <CodeBlock body={artifacts} tone="muted" />
    </DetailPane>
  );
}

/** Standalone entry when only raw output is available (no parent parse). */
export function SubAgentArtifactsFromOutput({ output }: { output: string }) {
  const parsed = parseResultEnvelope(output);
  return <SubAgentArtifacts parsed={parsed} />;
}
