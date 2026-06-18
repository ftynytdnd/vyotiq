/**
 * Strip native vision parts from older user turns during context compaction.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { VISION_COMPACTION_KEEP_TURNS } from '@shared/constants.js';
import { isChatContentPartArray } from '@shared/text/chatContent.js';
import { wrapXml } from '../envelope/index.js';

function hasNativeVisionParts(content: ChatMessage['content']): boolean {
  if (!isChatContentPartArray(content)) return false;
  return content.some(
    (p) =>
      p.type === 'image_url' ||
      p.type === 'file' ||
      p.type === 'video_url' ||
      p.type === 'input_audio'
  );
}

function stripVisionContent(content: ChatMessage['content']): string {
  const text =
    typeof content === 'string'
      ? content
      : isChatContentPartArray(content)
        ? content
            .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
            .map((p) => p.text)
            .join('\n')
        : '';
  const note = wrapXml(
    'vision_stripped',
    'Native vision media removed from this turn during context compaction.',
    { reason: 'context-compaction' },
    { escape: true }
  );
  return text.length > 0 ? `${text}\n${note}` : note;
}

/**
 * Keep the most recent N user turns with vision parts; strip older ones.
 */
export function stripOldVisionParts(messages: readonly ChatMessage[]): {
  messages: ChatMessage[];
  didStrip: boolean;
} {
  const userVisionIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'user' && hasNativeVisionParts(m.content)) {
      userVisionIndices.push(i);
    }
  }
  if (userVisionIndices.length <= VISION_COMPACTION_KEEP_TURNS) {
    return { messages: [...messages], didStrip: false };
  }
  const stripSet = new Set(
    userVisionIndices.slice(0, userVisionIndices.length - VISION_COMPACTION_KEEP_TURNS)
  );
  return {
    didStrip: true,
    messages: messages.map((m, i) => {
      if (!stripSet.has(i)) return m;
      return { ...m, content: stripVisionContent(m.content) };
    })
  };
}
