import { describe, expect, it } from 'vitest';
import {
  messagesSanitizeFingerprint,
  sanitizeToolCallPairingWithStats
} from '@main/orchestrator/loop/sanitizeToolPairing';
import type { ChatMessage } from '@shared/types/chat';

describe('messagesSanitizeFingerprint', () => {
  it('ignores system prompt changes at index 0', () => {
    const tail: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ls', arguments: '{}' } }]
      },
      { role: 'tool', tool_call_id: 'c1', name: 'ls', content: 'ok' }
    ];
    const a = [{ role: 'system', content: 'v1' }, ...tail] as ChatMessage[];
    const b = [{ role: 'system', content: 'v2 — rebuilt host env' }, ...tail] as ChatMessage[];
    expect(messagesSanitizeFingerprint(a)).toBe(messagesSanitizeFingerprint(b));
  });

  it('changes when a tool response is appended', () => {
    const before: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' }
    ];
    const after: ChatMessage[] = [
      ...before,
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ls', arguments: '{}' } }]
      }
    ];
    expect(messagesSanitizeFingerprint(before)).not.toBe(messagesSanitizeFingerprint(after));
  });

  it('shares fingerprint when only the system envelope at index 0 changed', () => {
    const tail: ChatMessage[] = [{ role: 'user', content: 'x' }];
    const m1 = [{ role: 'system', content: 'a' }, ...tail] as ChatMessage[];
    const m2 = [{ role: 'system', content: 'b' }, ...tail] as ChatMessage[];
    expect(messagesSanitizeFingerprint(m1)).toBe(messagesSanitizeFingerprint(m2));
    const s1 = sanitizeToolCallPairingWithStats(m1);
    const s2 = sanitizeToolCallPairingWithStats(m2);
    expect(s1.stats).toEqual(s2.stats);
    expect(s1.messages.slice(1)).toEqual(s2.messages.slice(1));
  });
});
