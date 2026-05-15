/**
 * `describeEndpointWarning` validates the persisted Web Search
 * endpoint exactly the same way `runWebSearch` does at runtime.
 * Locking that contract here so the UI banner can never go out of
 * sync with the tool's refusal logic.
 */

import { describe, expect, it } from 'vitest';
import { describeEndpointWarning } from '@renderer/components/settings/endpointWarning';

describe('describeEndpointWarning', () => {
  it('warns when web search is on but no endpoint is set', () => {
    expect(describeEndpointWarning(true, '')).toMatch(/no endpoint is configured/);
  });

  it('returns null when web search is off and no endpoint set', () => {
    expect(describeEndpointWarning(false, '')).toBeNull();
  });

  it('returns null for a valid HTTPS endpoint', () => {
    expect(describeEndpointWarning(true, 'https://api.example.com/search')).toBeNull();
  });

  it('returns null for http://localhost', () => {
    expect(describeEndpointWarning(true, 'http://localhost:8080/search')).toBeNull();
  });

  it('returns null for http://127.0.0.1', () => {
    expect(describeEndpointWarning(true, 'http://127.0.0.1:1234/q')).toBeNull();
  });

  it('warns about a non-https endpoint to a non-localhost host', () => {
    const msg = describeEndpointWarning(true, 'http://evil.example.com/q');
    expect(msg).toMatch(/Non-HTTPS endpoints/);
    expect(msg).toContain('evil.example.com');
  });

  it('warns when the endpoint is not a valid URL', () => {
    expect(describeEndpointWarning(true, 'not a url')).toMatch(/not a valid URL/);
  });

  it('trims whitespace before evaluating', () => {
    expect(describeEndpointWarning(true, '   https://ok.example.com   ')).toBeNull();
  });
});
