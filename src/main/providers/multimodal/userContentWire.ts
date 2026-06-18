/**
 * Map canonical `ChatContentPart[]` user content to provider wire shapes.
 */

import type { ChatContentPart } from '@shared/types/chat.js';
import { chatContentToText, isChatContentPartArray } from '@shared/text/chatContent.js';
import { parseDataUrl } from './parseDataUrl.js';

export function normalizeUserContent(
  content: string | ChatContentPart[] | null | undefined
): string | ChatContentPart[] {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content;
}

export function userContentHasMultimodalParts(
  content: string | ChatContentPart[] | null | undefined
): boolean {
  if (!isChatContentPartArray(content)) return false;
  return content.some(
    (p) => p.type === 'image_url' || p.type === 'file' || p.type === 'video_url'
  );
}

/** Anthropic content blocks for a user message. */
export type AnthropicUserWireBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    }
  | {
      type: 'document';
      source: { type: 'base64'; media_type: string; data: string };
    };

export function toAnthropicUserBlocks(
  content: string | ChatContentPart[] | null | undefined
): AnthropicUserWireBlock[] {
  if (!isChatContentPartArray(content)) {
    const text = typeof content === 'string' ? content : '';
    return text.length > 0 ? [{ type: 'text', text }] : [];
  }
  const blocks: AnthropicUserWireBlock[] = [];
  for (const part of content) {
    switch (part.type) {
      case 'text':
        if (part.text.length > 0) blocks.push({ type: 'text', text: part.text });
        break;
      case 'image_url': {
        const parsed = parseDataUrl(part.image_url.url);
        if (parsed) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: parsed.mime, data: parsed.base64 }
          });
        }
        break;
      }
      case 'file': {
        const parsed = parseDataUrl(part.file.file_data);
        if (parsed) {
          blocks.push({
            type: 'document',
            source: { type: 'base64', media_type: parsed.mime, data: parsed.base64 }
          });
        }
        break;
      }
      case 'video_url': {
        const parsed = parseDataUrl(part.video_url.url);
        if (parsed) {
          blocks.push({
            type: 'document',
            source: { type: 'base64', media_type: parsed.mime, data: parsed.base64 }
          });
        }
        break;
      }
      default: {
        const _exhaustive: never = part;
        void _exhaustive;
      }
    }
  }
  return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
}

export interface GeminiUserPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export function toGeminiUserParts(
  content: string | ChatContentPart[] | null | undefined
): GeminiUserPart[] {
  if (!isChatContentPartArray(content)) {
    const text = typeof content === 'string' ? content : '';
    return text.length > 0 ? [{ text }] : [{ text: '' }];
  }
  const parts: GeminiUserPart[] = [];
  for (const part of content) {
    switch (part.type) {
      case 'text':
        if (part.text.length > 0) parts.push({ text: part.text });
        break;
      case 'image_url':
      case 'file':
      case 'video_url': {
        const url =
          part.type === 'image_url'
            ? part.image_url.url
            : part.type === 'file'
              ? part.file.file_data
              : part.video_url.url;
        const parsed = parseDataUrl(url);
        if (parsed) {
          parts.push({ inlineData: { mimeType: parsed.mime, data: parsed.base64 } });
        }
        break;
      }
      default: {
        const _exhaustive: never = part;
        void _exhaustive;
      }
    }
  }
  return parts.length > 0 ? parts : [{ text: '' }];
}

export interface OllamaUserWire {
  content: string;
  images?: string[];
}

export function toOllamaUserWire(
  content: string | ChatContentPart[] | null | undefined
): OllamaUserWire {
  if (!isChatContentPartArray(content)) {
    return { content: typeof content === 'string' ? content : '' };
  }
  const images: string[] = [];
  for (const part of content) {
    if (part.type === 'image_url') {
      const parsed = parseDataUrl(part.image_url.url);
      if (parsed) images.push(parsed.base64);
    }
  }
  const text = chatContentToText(content);
  return images.length > 0 ? { content: text, images } : { content: text };
}

/** OpenAI Chat Completions accepts our canonical parts array directly. */
export function toOpenAiUserContent(
  content: string | ChatContentPart[] | null | undefined
): string | ChatContentPart[] {
  return normalizeUserContent(content);
}
