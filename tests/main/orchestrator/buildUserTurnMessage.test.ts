import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatMessage, PromptAttachmentMeta, TimelineEvent } from '@shared/types/chat.js';
import { CONTEXT_SUMMARY_OPEN } from '@main/orchestrator/context/contextSummarize.js';
import { buildContextSummaryMessage } from '@main/orchestrator/context/contextSummarize.js';
import { wrapXml } from '@main/orchestrator/envelope/index.js';

const notifyUiToast = vi.fn();
const prepareVisionParts = vi.fn();

vi.mock('@main/ui/uiToast.js', () => ({
  notifyUiToast
}));

vi.mock('@main/attachments/prepareMediaForVision.js', () => ({
  prepareVisionParts
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

const { listProviders } = await import('@main/providers/providerStore.js');
const { resolveInputModalitiesForSelection } = await import(
  '@main/orchestrator/buildUserTurnMessage.js'
);

describe('buildUserTurnMessage — native media toast', () => {
  beforeEach(() => {
    notifyUiToast.mockClear();
    prepareVisionParts.mockReset();
    prepareVisionParts.mockResolvedValue({
      parts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],
      visionTokenEstimate: 100,
      preparedAttachmentHashes: {},
      preparedWorkspacePaths: []
    });
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

describe('enrichReplayedVisionMessages', () => {
  beforeEach(() => {
    prepareVisionParts.mockReset();
    prepareVisionParts.mockResolvedValue({
      parts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,post' } }],
      visionTokenEstimate: 50,
      preparedAttachmentHashes: {},
      preparedWorkspacePaths: []
    });
  });

  it('skips context-summary rows and matches post-summary prompts only', async () => {
    const { enrichReplayedVisionMessages } = await import('@main/orchestrator/buildUserTurnMessage.js');
    const preSummaryAttachment: PromptAttachmentMeta = {
      id: 'old',
      name: 'old.png',
      workspacePath: 'old.png',
      mimeType: 'image/png',
      mediaKind: 'image'
    };
    const postSummaryAttachment: PromptAttachmentMeta = {
      id: 'new',
      name: 'new.png',
      workspacePath: 'new.png',
      mimeType: 'image/png',
      mediaKind: 'image'
    };
    const events: TimelineEvent[] = [
      {
        kind: 'user-prompt',
        id: 'p1',
        ts: 1,
        content: 'before summary',
        attachments: [preSummaryAttachment]
      },
      {
        kind: 'context-summary',
        id: 's1',
        ts: 2,
        summary: 'compressed',
        relativePath: '.vyotiq/context-summaries/s1.md'
      },
      {
        kind: 'user-prompt',
        id: 'p2',
        ts: 3,
        content: 'after summary',
        attachments: [postSummaryAttachment]
      }
    ];
    const summaryContent = buildContextSummaryMessage('compressed', '.vyotiq/context-summaries/s1.md');
    const postPromptXml = wrapXml(
      'turn',
      wrapXml('user_message', 'after summary', undefined, { escape: true })
    );
    const messages: ChatMessage[] = [
      { role: 'user', content: summaryContent },
      { role: 'user', content: postPromptXml }
    ];

    const enriched = await enrichReplayedVisionMessages(messages, events, {
      selection: { providerId: 'openai', modelId: 'gpt-4o' },
      workspacePath: '/ws',
      inputModalities: ['text', 'image']
    });

    expect(summaryContent).toContain(CONTEXT_SUMMARY_OPEN);
    expect(enriched[0]?.content).toBe(summaryContent);
    expect(Array.isArray(enriched[1]?.content)).toBe(true);
    expect(prepareVisionParts).toHaveBeenCalledTimes(1);
    expect(prepareVisionParts).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentMeta: [postSummaryAttachment]
      })
    );
  });
});

describe('resolveInputModalitiesForSelection', () => {
  beforeEach(() => {
    vi.mocked(listProviders).mockReset();
  });

  it('falls back to model-id heuristics when the discovered row omits inputModalities', async () => {
    vi.mocked(listProviders).mockResolvedValue([
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        dialect: 'openai',
        enabled: true,
        models: [{ id: 'gpt-4o' }],
        apiKey: 'sk-test'
      }
    ]);

    const modalities = await resolveInputModalitiesForSelection({
      providerId: 'openai',
      modelId: 'gpt-4o'
    });

    expect(modalities).toContain('text');
    expect(modalities).toContain('image');
  });
});
