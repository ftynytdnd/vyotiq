/**
 * Pins the `supportsForcedToolChoice` dialect capability map.
 *
 * The forced-action orchestrator loop always sends
 * `tool_choice:'required'`, but not every wire dialect enforces it
 * server-side. This map decides whether a dialect is trusted to honour
 * the forced choice (capable) or needs the prompt-force degradation
 * path (`ollama-native`). A regression here would silently break either
 * the "narrate without acting is impossible" guarantee (capable) or the
 * graceful-degradation path (ollama).
 */

import { describe, expect, it } from 'vitest';
import { supportsForcedToolChoice } from '@main/providers/capabilities';
import { PROVIDER_DIALECTS } from '@shared/types/provider';

describe('supportsForcedToolChoice', () => {
  it('treats openai / anthropic-native / gemini-native as forced-capable', () => {
    expect(supportsForcedToolChoice('openai')).toBe(true);
    expect(supportsForcedToolChoice('anthropic-native')).toBe(true);
    expect(supportsForcedToolChoice('gemini-native')).toBe(true);
  });

  it('treats undefined (unknown / legacy dialect) as NOT forced-capable', () => {
    expect(supportsForcedToolChoice(undefined)).toBe(false);
  });

  it('treats ollama-native as NOT forced-capable (needs prompt-force)', () => {
    expect(supportsForcedToolChoice('ollama-native')).toBe(false);
  });

  it('returns a boolean for every known dialect (exhaustive switch)', () => {
    // Guards the exhaustive `switch` — TS would error on a new dialect,
    // and this asserts no dialect returns `undefined` at runtime.
    for (const dialect of PROVIDER_DIALECTS) {
      expect(typeof supportsForcedToolChoice(dialect)).toBe('boolean');
    }
  });
});
