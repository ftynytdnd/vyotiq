/**
 * Regression tests for `assertChatSendInput`.
 *
 * Pins the M-03 wire contract: malformed payloads reject before the
 * handler touches conversation state, and attachment arrays validate
 * each element (not just `Array.isArray`).
 */

import { describe, expect, it } from 'vitest';
import { MAX_CHAT_ATTACHMENTS, MAX_USER_PROMPT_BYTES } from '@shared/constants';
import { assertChatSendInput } from '@main/ipc/chatValidate';
import type { ChatSendInput } from '@shared/types/chat';

const VALID: ChatSendInput = {
  runId: 'run-1',
  prompt: 'hello',
  selection: { providerId: 'openai', modelId: 'gpt-4o' },
  permissions: {},
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  attachments: ['src/index.ts']
};

describe('assertChatSendInput', () => {
  it('accepts a fully-shaped renderer payload', () => {
    expect(() => assertChatSendInput(VALID)).not.toThrow();
  });

  it('accepts an empty prompt string', () => {
    expect(() => assertChatSendInput({ ...VALID, prompt: '' })).not.toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => assertChatSendInput(null)).toThrow(/chat:send: input must be a non-null object/);
    expect(() => assertChatSendInput('nope')).toThrow(/chat:send: input must be a non-null object/);
  });

  it('rejects a missing runId', () => {
    const { runId: _drop, ...rest } = VALID;
    void _drop;
    expect(() => assertChatSendInput(rest)).toThrow(/runId must be a string/);
  });

  it('rejects an empty runId', () => {
    expect(() => assertChatSendInput({ ...VALID, runId: '' })).toThrow(/runId must be a non-empty string/);
  });

  it('rejects prompts over the byte cap', () => {
    const over = 'a'.repeat(MAX_USER_PROMPT_BYTES + 1);
    expect(() => assertChatSendInput({ ...VALID, prompt: over })).toThrow(/prompt exceeds/);
  });

  it('rejects null selection / permissions', () => {
    expect(() => assertChatSendInput({ ...VALID, selection: null })).toThrow(
      /selection must be a non-null object/
    );
    expect(() => assertChatSendInput({ ...VALID, permissions: null })).toThrow(
      /permissions must be a non-null object/
    );
  });

  it('accepts an empty permissions object', () => {
    expect(() =>
      assertChatSendInput({
        ...VALID,
        permissions: {}
      })
    ).not.toThrow();
  });

  it('rejects null optional ids', () => {
    expect(() => assertChatSendInput({ ...VALID, conversationId: null })).toThrow(
      /conversationId must be a string/
    );
    expect(() => assertChatSendInput({ ...VALID, workspaceId: null })).toThrow(
      /workspaceId must be a string/
    );
  });

  it('rejects attachments that are not string arrays', () => {
    expect(() => assertChatSendInput({ ...VALID, attachments: 'src/foo.ts' })).toThrow(
      /attachments must be an array/
    );
    expect(() => assertChatSendInput({ ...VALID, attachments: [42] })).toThrow(
      /attachments\[0\] must be a string/
    );
  });

  it('rejects attachment arrays over the item cap', () => {
    const tooMany = Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, (_, i) => `f${i}.ts`);
    expect(() => assertChatSendInput({ ...VALID, attachments: tooMany })).toThrow(
      /attachments exceeds/
    );
  });

  it('rejects malformed attachmentMeta entries', () => {
    expect(() =>
      assertChatSendInput({
        ...VALID,
        attachmentMeta: [{ id: 'a1', name: 'x.txt' }]
      })
    ).toThrow(/must include workspacePath or storedPath/);

    expect(() =>
      assertChatSendInput({
        ...VALID,
        attachmentMeta: [{ id: '', name: 'x.txt', workspacePath: 'a.ts' }]
      })
    ).toThrow(/attachmentMeta\[0\]\.id must be a non-empty string/);

    expect(() =>
      assertChatSendInput({
        ...VALID,
        attachmentMeta: [{ id: 'a1', name: 'x.txt', workspacePath: 'src/a.ts', external: 'yes' }]
      })
    ).toThrow(/attachmentMeta\[0\]\.external must be a boolean/);
  });

  it('accepts well-formed attachmentMeta', () => {
    expect(() =>
      assertChatSendInput({
        ...VALID,
        attachmentMeta: [
          { id: 'a1', name: 'a.ts', workspacePath: 'src/a.ts', external: false },
          { id: 'a2', name: 'b.pdf', storedPath: '/tmp/b.pdf', external: true, sizeBytes: 42 }
        ]
      })
    ).not.toThrow();
  });
});
