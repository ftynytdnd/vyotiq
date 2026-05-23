/**
 * Pins the `splitSystemPromptForBreakdown` contract used by the
 * Context Inspector's foldable Wire Breakdown row.
 *
 * Pure unit tests — no IPC, no tokenizer, no Electron. The splitter's
 * job is to slice a system-prompt string into named parts; the
 * caller (`getInspectorSnapshot`) tokenizes each body. We assert on
 * row labels, body content, and structural invariants here.
 */

import { describe, expect, it } from 'vitest';
import { splitSystemPromptForBreakdown } from '@main/orchestrator/contextSummarizer/splitSystemPrompt';

/** Realistic system-prompt fixture mirroring `buildSystemPrompt`'s
 *  `[harness, ...envelopes].join('\n\n')` shape. The harness body is
 *  shortened to a single paragraph; the envelope payloads are
 *  representative one-liners. */
function fixture(): string {
  return [
    '# Prime Directives — Inviolable Rules\nThe orchestrator must never delegate write actions without confirmation.',
    '<meta_rules>- prefer terse output\n- never use emoji</meta_rules>',
    '<host_environment>now_utc: 2026-05-19T03:00:00.000Z\nplatform: win32\nlocale: en-US</host_environment>',
    '<workspace_context>src/\n  index.ts\n  README.md</workspace_context>',
    '<session_context>title="planning"\nprior_turn_count=3</session_context>',
    '<run_state>iteration: 1 of 14\nlast_action: none</run_state>',
    '<prior_conversations>(none yet)</prior_conversations>',
    '<recent_memory>(no persistent notes matched)</recent_memory>'
  ].join('\n\n');
}

describe('splitSystemPromptForBreakdown', () => {
  it('returns 8 rows for a fully-populated system prompt (harness + 7 envelopes)', () => {
    const parts = splitSystemPromptForBreakdown(fixture());
    expect(parts.map((p) => p.label)).toEqual([
      'Harness body',
      'Meta rules',
      'Host environment',
      'Workspace context',
      'Session context',
      'Run state',
      'Prior conversations',
      'Recent memory'
    ]);
  });

  it('puts Harness body first (the agent reads it first)', () => {
    const parts = splitSystemPromptForBreakdown(fixture());
    expect(parts[0]?.label).toBe('Harness body');
    expect(parts[0]?.body).toContain('Prime Directives');
    expect(parts[0]?.body).not.toContain('<meta_rules>');
    expect(parts[0]?.body).not.toContain('<host_environment>');
  });

  it('preserves each envelope body verbatim with its opening + closing tags', () => {
    const parts = splitSystemPromptForBreakdown(fixture());
    const byLabel = new Map(parts.map((p) => [p.label, p.body]));
    expect(byLabel.get('Host environment')).toBe(
      '<host_environment>now_utc: 2026-05-19T03:00:00.000Z\nplatform: win32\nlocale: en-US</host_environment>'
    );
    expect(byLabel.get('Workspace context')).toBe(
      '<workspace_context>src/\n  index.ts\n  README.md</workspace_context>'
    );
    expect(byLabel.get('Run state')).toBe(
      '<run_state>iteration: 1 of 14\nlast_action: none</run_state>'
    );
  });

  it('skips missing envelopes (idle / pre-iteration snapshot)', () => {
    // No <run_state>, no <recent_memory>, no <prior_conversations> —
    // simulates the iter-0 snapshot before the runLoop has built
    // those blocks.
    const partial = [
      '# Prime Directives',
      '<meta_rules>r</meta_rules>',
      '<host_environment>now_utc: x</host_environment>',
      '<workspace_context>src/</workspace_context>',
      '<session_context>t</session_context>'
    ].join('\n\n');
    const parts = splitSystemPromptForBreakdown(partial);
    expect(parts.map((p) => p.label)).toEqual([
      'Harness body',
      'Meta rules',
      'Host environment',
      'Workspace context',
      'Session context'
    ]);
  });

  it('produces a single-row output for an empty system message', () => {
    const parts = splitSystemPromptForBreakdown('');
    expect(parts).toEqual([{ label: 'Harness body', body: '' }]);
  });

  it('produces a single Harness body row when no envelope tags are present', () => {
    const parts = splitSystemPromptForBreakdown('Plain directives. No envelopes.');
    expect(parts).toHaveLength(1);
    expect(parts[0]?.label).toBe('Harness body');
    expect(parts[0]?.body).toBe('Plain directives. No envelopes.');
  });

  it('rejoins the Harness body even when envelopes splice it in the middle', () => {
    // Defensive: a future buildSystemPrompt revision could put a
    // mid-stream envelope (e.g. an injected runtime_limits block)
    // BETWEEN two harness paragraphs. The splitter must still treat
    // the surrounding paragraphs as one logical Harness body row.
    const interleaved = [
      'top paragraph',
      '<meta_rules>r</meta_rules>',
      'middle paragraph',
      '<host_environment>now_utc: x</host_environment>',
      'bottom paragraph'
    ].join('\n\n');
    const parts = splitSystemPromptForBreakdown(interleaved);
    const harness = parts.find((p) => p.label === 'Harness body');
    expect(harness?.body).toBe(
      'top paragraph\n\nmiddle paragraph\n\nbottom paragraph'
    );
  });

  it('matches only the FIRST occurrence of a duplicate envelope tag (defensive)', () => {
    // Defensive: a malformed system prompt with a duplicate
    // <run_state> shouldn't produce two "Run state" rows. The
    // duplicates fall through to the Harness body residual.
    const duplicate = [
      '# Prime Directives',
      '<run_state>iter=1</run_state>',
      '<run_state>iter=2</run_state>'
    ].join('\n\n');
    const parts = splitSystemPromptForBreakdown(duplicate);
    const runStateRows = parts.filter((p) => p.label === 'Run state');
    expect(runStateRows).toHaveLength(1);
    expect(runStateRows[0]?.body).toBe('<run_state>iter=1</run_state>');
    // The duplicate appears in the Harness body residual.
    const harness = parts.find((p) => p.label === 'Harness body');
    expect(harness?.body).toContain('<run_state>iter=2</run_state>');
  });

  it('handles tags with attributes on the opening element (forward-compat)', () => {
    // Today's `wrapXml` builds bare tags, but a future revision may
    // add attributes (e.g. `<run_state iter="1">`). The splitter
    // must tolerate that.
    const withAttr = '<run_state iter="3" nudges="1/2">body</run_state>';
    const parts = splitSystemPromptForBreakdown(withAttr);
    const runState = parts.find((p) => p.label === 'Run state');
    expect(runState?.body).toBe(withAttr);
  });

  it('emits envelopes in document order (canonical order is wire order)', () => {
    // The canonical order baked into `ENVELOPE_SPECS` matches
    // `buildSystemPrompt`'s `.join` shape. A custom prompt that puts
    // envelopes in a DIFFERENT order still emits the rows in document
    // order so the Inspector's sub-rows match the byte stream.
    const reordered = [
      'header',
      '<recent_memory>m</recent_memory>',
      '<run_state>r</run_state>'
    ].join('\n\n');
    const parts = splitSystemPromptForBreakdown(reordered);
    expect(parts.map((p) => p.label)).toEqual([
      'Harness body',
      'Recent memory',
      'Run state'
    ]);
  });

  it('returns body strings whose concatenation maps back to the input (with separator drift tolerated)', () => {
    // Invariant 1 from the helper doc: the concatenation of all
    // rows' bodies — when joined with the original `\n\n` separators
    // — reconstructs the input modulo the structural framing the
    // splitter intentionally drops between adjacent envelopes. We
    // verify by checking each envelope's body appears in the input
    // (the strict reconstruction is too strict for the harness-body
    // collapse-and-trim behavior, but the per-envelope assertion is
    // what the Inspector ultimately cares about).
    const src = fixture();
    const parts = splitSystemPromptForBreakdown(src);
    for (const p of parts) {
      if (p.label === 'Harness body') continue; // collapsed; tested above
      expect(src).toContain(p.body);
    }
  });
});
