import { describe, expect, it } from 'vitest';
import {
  buildOrchestratorSystemPrompt,
  buildStaticFewShotXml
} from '@main/harness/harnessLoader';
import {
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

  it('does not embed few-shot patterns in the harness system prefix', () => {
    expect(prompt).not.toContain('Static Few-Shot Patterns');
    expect(prompt).not.toContain('Read before edit');
  });

  it('buildStaticFewShotXml supplies the dedicated cache-layer slot', () => {
    const fewShot = buildStaticFewShotXml();
    expect(fewShot).toContain('<static_examples>');
    expect(fewShot).toContain('Read before edit');
  });

  it('cites runtime limits from constants', () => {
    expect(prompt).toContain('<runtime_limits>');
    expect(prompt).toContain(`MAX_TOTAL_ITERATIONS=${MAX_TOTAL_ITERATIONS}`);
    expect(prompt).toContain(`MAX_SELF_CORRECTION_ATTEMPTS=${MAX_SELF_CORRECTION_ATTEMPTS}`);
    expect(prompt).toContain(`STREAM_INACTIVITY_TIMEOUT_MS=${STREAM_INACTIVITY_TIMEOUT_MS}`);
    expect(prompt).toContain(`MAX_TOOL_OUTPUT_CHARS=${MAX_TOOL_OUTPUT_CHARS}`);
  });

  it('does not expose delegate or sub-agent runtime limits', () => {
    expect(prompt).not.toContain('### Tool: `delegate`');
    expect(prompt).not.toContain('SUBAGENT_');
    expect(prompt).not.toContain('MAX_DELEGATION');
  });

  it('lists direct agent tools in the catalogue', () => {
    expect(prompt).toContain('- `read` —');
    expect(prompt).toContain('- `edit` —');
    expect(prompt).toContain('- `finish` —');
  });

  it('includes deliverables guidance for markdown vs HTML reports', () => {
    expect(prompt).toContain('Deliverables — Timeline Markdown vs HTML Reports');
    expect(prompt).toContain('vy-severity-table');
    expect(prompt).toContain('≤80 lines');
    expect(prompt).toContain('**MUST** call `report`');
  });
});
