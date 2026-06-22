/**
 * Dialect-shaped payloads for provider `count_tokens` endpoints.
 * Mirrors the Anthropic / Gemini chat translators (system hoist, tool
 * blocks, tool schemas) so remote counts track billed wire shape better
 * than a flattened single-user string.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { chatContentToText } from '@shared/text/chatContent.js';
import type { TokenizableToolSchema } from './tokenCounter.js';

function messageText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  return chatContentToText(content);
}

function parseToolInput(args: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args || '{}') as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* malformed args — Anthropic requires an object */
  }
  return {};
}

/** Stable fingerprint for cache keys — wire body without model id. */
export function fingerprintCountPayload(
  dialect: 'anthropic-native' | 'gemini-native',
  messages: readonly ChatMessage[],
  tools: ReadonlyArray<TokenizableToolSchema>
): string {
  const body =
    dialect === 'anthropic-native'
      ? buildAnthropicCountBody('', messages, tools)
      : buildGeminiCountBody('', messages, tools);
  const { model: _model, ...rest } = body;
  void _model;
  return JSON.stringify(rest);
}

export function buildAnthropicCountBody(
  modelId: string,
  messages: readonly ChatMessage[],
  tools: ReadonlyArray<TokenizableToolSchema>
): Record<string, unknown> {
  const systemParts: string[] = [];
  const wireMessages: Array<{ role: 'user' | 'assistant'; content: unknown[] }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      const text = messageText(m.content);
      if (text.length > 0) systemParts.push(text);
      continue;
    }
    if (m.role === 'tool') {
      const tool_use_id =
        typeof m.tool_call_id === 'string' && m.tool_call_id.length > 0
          ? m.tool_call_id
          : (m.name ?? 'unknown');
      wireMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id,
            content: messageText(m.content)
          }
        ]
      });
      continue;
    }
    if (m.role === 'user') {
      const text = messageText(m.content);
      if (text.length > 0) {
        wireMessages.push({ role: 'user', content: [{ type: 'text', text }] });
      }
      continue;
    }
    const blocks: unknown[] = [];
    if (
      typeof m.reasoning_content === 'string' &&
      m.reasoning_content.length > 0 &&
      typeof m.reasoning_signature === 'string' &&
      m.reasoning_signature.length > 0
    ) {
      blocks.push({
        type: 'thinking',
        thinking: m.reasoning_content,
        signature: m.reasoning_signature
      });
    }
    const text = messageText(m.content);
    if (text.length > 0) blocks.push({ type: 'text', text });
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parseToolInput(tc.function.arguments)
        });
      }
    }
    if (blocks.length > 0) wireMessages.push({ role: 'assistant', content: blocks });
  }

  const body: Record<string, unknown> = {
    model: modelId,
    messages: wireMessages
  };
  if (systemParts.length > 0) body['system'] = systemParts.join('\n\n');
  if (tools.length > 0) {
    body['tools'] = tools.map((t) => ({
      name: t.function.name,
      ...(t.function.description ? { description: t.function.description } : {}),
      input_schema: t.function.parameters ?? { type: 'object', properties: {} }
    }));
  }
  return body;
}

export function buildGeminiCountBody(
  modelId: string,
  messages: readonly ChatMessage[],
  tools: ReadonlyArray<TokenizableToolSchema>
): Record<string, unknown> {
  const systemParts: string[] = [];
  const contents: Array<{ role: 'user' | 'model'; parts: unknown[] }> = [];

  for (const m of messages) {
    if (m.role === 'system') {
      const text = messageText(m.content);
      if (text.length > 0) systemParts.push(text);
      continue;
    }
    if (m.role === 'tool') {
      let parsed: Record<string, unknown> = {};
      try {
        const raw = JSON.parse(messageText(m.content)) as unknown;
        if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
          parsed = raw as Record<string, unknown>;
        } else {
          parsed = { result: raw };
        }
      } catch {
        parsed = { result: messageText(m.content) };
      }
      const name = m.name ?? 'unknown';
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: parsed } }]
      });
      continue;
    }
    if (m.role === 'user') {
      const text = messageText(m.content);
      if (text.length > 0) contents.push({ role: 'user', parts: [{ text }] });
      continue;
    }
    const parts: unknown[] = [];
    const text = messageText(m.content);
    if (text.length > 0) parts.push({ text });
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: parseToolInput(tc.function.arguments)
          }
        });
      }
    }
    if (parts.length > 0) contents.push({ role: 'model', parts });
  }

  const body: Record<string, unknown> = { model: modelId, contents };
  if (systemParts.length > 0) {
    body['systemInstruction'] = { parts: [{ text: systemParts.join('\n\n') }] };
  }
  if (tools.length > 0) {
    body['tools'] = tools.map((t) => ({
      functionDeclarations: [
        {
          name: t.function.name,
          ...(t.function.description ? { description: t.function.description } : {}),
          parameters: t.function.parameters ?? { type: 'object', properties: {} }
        }
      ]
    }));
  }
  return body;
}
