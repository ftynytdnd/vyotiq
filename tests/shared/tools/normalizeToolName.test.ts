import { describe, expect, it } from 'vitest';
import { normalizeRegisteredToolName } from '@shared/tools/normalizeToolName';

describe('normalizeRegisteredToolName', () => {
  it('returns canonical names unchanged', () => {
    expect(normalizeRegisteredToolName('finish')).toBe('finish');
    expect(normalizeRegisteredToolName('ask_user')).toBe('ask_user');
  });

  it('trims whitespace and lowercases', () => {
    expect(normalizeRegisteredToolName('  Finish  ')).toBe('finish');
  });

  it('strips common namespace prefixes', () => {
    expect(normalizeRegisteredToolName('functions.finish')).toBe('finish');
    expect(normalizeRegisteredToolName('default_api:read')).toBe('read');
  });

  it('returns null for unknown tools', () => {
    expect(normalizeRegisteredToolName('not_a_tool')).toBeNull();
    expect(normalizeRegisteredToolName('')).toBeNull();
    expect(normalizeRegisteredToolName(undefined)).toBeNull();
  });
});
