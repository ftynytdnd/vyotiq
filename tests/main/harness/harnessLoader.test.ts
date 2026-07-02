import { describe, expect, it } from 'vitest';
import { buildOrchestratorSystemPrompt } from '@main/harness/harnessLoader';
import { getContextPackBody } from '@main/harness/contextPacks';
import { CONTEXT_PACK_IDS } from '@shared/types/harness';
import {
  IMPLICIT_FINISH_MIN_CHARS,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOOL_OUTPUT_CHARS,
  MAX_TOTAL_ITERATIONS,
  STREAM_INACTIVITY_TIMEOUT_MS
} from '@shared/constants';

describe('buildOrchestratorSystemPrompt', () => {
  const prompt = buildOrchestratorSystemPrompt();

  it('wraps the harness in <system_instructions>', () => {
    expect(prompt.startsWith('<system_instructions>')).toBe(true);
    expect(prompt.endsWith('</system_instructions>')).toBe(true);
  });

  it('includes agent core sections', () => {
    expect(prompt).toContain('# Prime Directives — Inviolable Rules');
    expect(prompt).toContain('one dynamic agent');
  });

  it('does not embed on-demand pack bodies in the system prefix', () => {
    // Reference packs are loaded on demand via the `context` tool, not forced
    // into the always-on prefix. (Markers chosen to be unique to pack bodies —
    // e.g. `vy-severity-table` also appears in the `report` tool brief.)
    expect(prompt).not.toContain('Read before edit');
    expect(prompt).not.toContain('## Metavariables');
    expect(prompt).not.toContain('Two surfaces, two formats');
  });

  it('advertises the on-demand skills catalogue in the prefix', () => {
    expect(prompt).toContain('# On-Demand Skills');
    expect(prompt).toContain('`ast-grep-reference`');
    expect(prompt).toContain('`deliverables`');
    expect(prompt).toContain('`static-examples`');
  });

  it('resolves a non-empty body for every on-demand pack', () => {
    for (const id of CONTEXT_PACK_IDS) {
      expect(getContextPackBody(id).trim().length).toBeGreaterThan(20);
    }
  });

  it('cites runtime limits from constants', () => {
    expect(prompt).toContain('<runtime_limits>');
    expect(prompt).toContain(`MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`);
    expect(prompt).toContain(`MAX_SELF_CORRECTION_ATTEMPTS=${MAX_SELF_CORRECTION_ATTEMPTS}`);
    expect(prompt).toContain(`STREAM_INACTIVITY_TIMEOUT_MS=${STREAM_INACTIVITY_TIMEOUT_MS}`);
    expect(prompt).toContain(`MAX_TOOL_OUTPUT_CHARS=${MAX_TOOL_OUTPUT_CHARS}`);
    expect(prompt).toContain(`IMPLICIT_FINISH_MIN_CHARS=${IMPLICIT_FINISH_MIN_CHARS}`);
    expect(prompt).toContain('RUN_TOKEN_BUDGET=optional');
  });

  it('does not expose delegate or sub-agent runtime limits', () => {
    expect(prompt).not.toContain('### Tool: `delegate`');
    expect(prompt).not.toContain('SUBAGENT_');
    expect(prompt).not.toContain('MAX_DELEGATION');
  });

  it('lists direct agent tools via briefMarkdown briefs', () => {
    expect(prompt).toContain('### Tool: `read`');
    expect(prompt).toContain('### Tool: `edit`');
    expect(prompt).toContain('### Tool: `finish`');
    expect(prompt).toContain('Plain-English briefs');
  });

  it('keeps deliverables guidance in the on-demand pack, not the prefix', () => {
    expect(prompt).not.toContain('Two surfaces, two formats');
    const body = getContextPackBody('deliverables');
    expect(body).toContain('Deliverables — Timeline Markdown vs HTML Reports');
    expect(body).toContain('vy-severity-table');
    expect(body).toContain('≤80 lines');
  });

  it('keeps the ast-grep reference in the on-demand pack, not the prefix', () => {
    expect(prompt).not.toContain('## Metavariables');
    const body = getContextPackBody('ast-grep-reference');
    expect(body).toContain('ast-grep Quick Reference');
    expect(body).toContain('Metavariables');
    expect(body).toContain('`search` tool');
  });

  it('exposes the context tool brief in the prefix', () => {
    expect(prompt).toContain('### Tool: `context`');
  });

  it('includes dynamic agent loop guidance in system instructions', () => {
    expect(prompt).toContain('Dynamic Agent Loop');
    expect(prompt).toContain('Verify before finish');
    expect(prompt).toContain('`heartbeat`');
    expect(prompt).toContain('`continue`');
    expect(prompt).toContain('Async iteration');
    expect(prompt).not.toContain('adversarial reviewer');
  });

  it('does not embed Cursor-specific audit skill or grep tool references', () => {
    expect(prompt).not.toContain('vyotiq-deep-audit');
    expect(prompt).not.toContain('`grep`');
    expect(prompt).not.toContain('Deep codebase audit');
  });
});
