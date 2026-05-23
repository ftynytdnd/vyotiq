import { describe, expect, it } from 'vitest';
import { buildDisplayChatTitles } from '../../../src/renderer/components/dock/displayChatTitles.js';
import type { ConversationMeta } from '../../../src/shared/types/chat.js';

function meta(id: string, title: string): ConversationMeta {
  return {
    id,
    title,
    workspaceId: 'ws-1',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0
  };
}

describe('buildDisplayChatTitles', () => {
  it('leaves unique titles unchanged', () => {
    const entries = [meta('a', 'Survey'), meta('b', 'Triage')];
    const map = buildDisplayChatTitles(entries);
    expect(map.get('a')).toBe('Survey');
    expect(map.get('b')).toBe('Triage');
  });

  it('suffixes duplicate titles with an index', () => {
    const entries = [meta('a', 'hi'), meta('b', 'hi'), meta('c', 'hi')];
    const map = buildDisplayChatTitles(entries);
    expect(map.get('a')).toBe('hi (1)');
    expect(map.get('b')).toBe('hi (2)');
    expect(map.get('c')).toBe('hi (3)');
  });

  it('matches case-insensitively when detecting duplicates', () => {
    const entries = [meta('a', 'Hi'), meta('b', 'hi')];
    const map = buildDisplayChatTitles(entries);
    expect(map.get('a')).toBe('Hi (1)');
    expect(map.get('b')).toBe('hi (2)');
  });
});
