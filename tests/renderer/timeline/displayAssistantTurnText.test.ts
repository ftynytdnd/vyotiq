/**
 * Coverage for `displayAssistantTurnText` — planning prose appears once
 * in the parent assistant row; legacy `<delegate>` markup is stripped.
 */

import { describe, expect, it } from 'vitest';
import { displayAssistantTurnText } from '@shared/text/assistantDisplayText';

describe('displayAssistantTurnText', () => {
  it('returns the full stripped text when no delegates are present', () => {
    const out = displayAssistantTurnText('Here is the answer you asked for.');
    expect(out).toBe('Here is the answer you asked for.');
  });

  it('keeps pre-delegate planning prose in the parent assistant row', () => {
    const input =
      'Plan:\n1. Inspect backend.\n\n' +
      '<delegate id="A1" task="read Cargo.toml" />\n' +
      '<delegate id="A2" task="read src/main.rs" />';
    const out = displayAssistantTurnText(input);
    expect(out).toContain('Inspect backend');
    expect(out).not.toContain('<delegate');
  });

  it('joins planning prose and a post-delegate tail when both exist', () => {
    const input =
      'Phase 1 analysis.\n\n' +
      '<delegate id="A1" task="x" />\n\n' +
      'Workers spawned — synthesizing results next.';
    const out = displayAssistantTurnText(input);
    expect(out).toContain('Phase 1 analysis');
    expect(out).toContain('Workers spawned');
  });

  it('does not leave a trailing fence opener while delegates are still streaming', () => {
    const input =
      'Plan:\n1. Analyze.\n2. Draft README.\n3. Generate docs.\n\n' +
      '```xml\n<delegate id="A1" task="Create README"';
    const out = displayAssistantTurnText(input);
    expect(out).toBe(
      'Plan:\n1. Analyze.\n2. Draft README.\n3. Generate docs.'
    );
    expect(out).not.toContain('```');
  });
});
