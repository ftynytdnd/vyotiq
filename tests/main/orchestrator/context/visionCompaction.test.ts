import { describe, expect, it } from 'vitest';
import { stripOldVisionParts } from '@main/orchestrator/context/visionCompaction.js';
import type { ChatMessage } from '@shared/types/chat.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function visionUser(text: string): ChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: PNG } },
      { type: 'text', text }
    ]
  };
}

describe('stripOldVisionParts', () => {
  it('leaves messages unchanged when within keep budget', () => {
    const messages = [visionUser('a'), visionUser('b'), visionUser('c')];
    const { messages: out, didStrip } = stripOldVisionParts(messages);
    expect(didStrip).toBe(false);
    expect(out).toEqual(messages);
  });

  it('strips native vision parts from older user turns', () => {
    const messages = [
      visionUser('oldest'),
      visionUser('middle'),
      visionUser('middle2'),
      visionUser('newest'),
      visionUser('latest')
    ];
    const { messages: out, didStrip } = stripOldVisionParts(messages);
    expect(didStrip).toBe(true);
    expect(typeof out[0]!.content).toBe('string');
    expect(String(out[0]!.content)).toContain('vision_stripped');
    expect(Array.isArray(out[4]!.content)).toBe(true);
  });
});
