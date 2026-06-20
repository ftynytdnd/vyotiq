import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';

const notifyUiToast = vi.fn();

vi.mock('@main/ui/uiToast.js', () => ({
  notifyUiToast
}));

vi.mock('@main/attachments/prepareMediaForVision.js', () => ({
  prepareVisionParts: vi.fn(async () => ({
    parts: [],
    visionTokenEstimate: 0,
    preparedAttachmentHashes: {},
    preparedWorkspacePaths: []
  }))
}));

vi.mock('@main/attachments/resolveAttachmentsForInline.js', () => ({
  resolveAttachmentsForInline: vi.fn(async () => '')
}));

vi.mock('@main/attachments/resolveMentionsForInline.js', () => ({
  resolveMentionsForInline: vi.fn(async () => '')
}));

vi.mock('@main/providers/providerStore.js', () => ({
  listProviders: vi.fn(async () => [])
}));

describe('buildUserTurnMessage — native media toast', () => {
  beforeEach(() => {
    notifyUiToast.mockClear();
  });

  it('warns when PDF attachments are unsupported by the selected model', async () => {
    const { buildUserTurnMessage } = await import('@main/orchestrator/buildUserTurnMessage.js');
    const attachment: PromptAttachmentMeta = {
      id: 'a1',
      name: 'spec.pdf',
      workspacePath: 'docs/spec.pdf',
      mimeType: 'application/pdf',
      mediaKind: 'pdf'
    };

    await buildUserTurnMessage({
      prompt: 'review',
      selection: { providerId: 'openai', modelId: 'gpt-4' },
      workspacePath: '/ws',
      attachmentMeta: [attachment],
      inputModalities: ['text', 'image'],
      conversationId: 'conv-1'
    });

    expect(notifyUiToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('PDFs'),
        variant: 'info',
        conversationId: 'conv-1'
      })
    );
  });
});
