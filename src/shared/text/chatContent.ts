/**
 * Helpers for multimodal `ChatMessage.content` (string or parts array).
 */

import type { ChatContentPart } from '../types/chat.js';

export function isChatContentPartArray(
  content: string | ChatContentPart[] | null | undefined
): content is ChatContentPart[] {
  return Array.isArray(content);
}

/** Flatten user message content to a single string (text parts only). */
export function chatContentToText(content: string | ChatContentPart[] | null | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is Extract<ChatContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

export function messageHasVisionParts(content: string | ChatContentPart[] | null | undefined): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (p) =>
      p.type === 'image_url' ||
      p.type === 'file' ||
      p.type === 'video_url' ||
      p.type === 'input_audio'
  );
}
