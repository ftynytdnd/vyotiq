import { describe, expect, it, vi, beforeEach } from 'vitest';

import {

  clearRunVisionQueue,

  flushVisionQueue,

  queueWorkspaceVision

} from '@main/orchestrator/runVisionQueue.js';

import { prepareVisionParts } from '@main/attachments/prepareMediaForVision.js';



vi.mock('@main/attachments/prepareMediaForVision.js', () => ({

  prepareVisionParts: vi.fn(async ({ attachmentMeta }: { attachmentMeta: Array<{ workspacePath?: string }> }) => ({

    parts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],

    visionTokenEstimate: 0,

    preparedWorkspacePaths: attachmentMeta

      .map((m) => m.workspacePath)

      .filter((p): p is string => typeof p === 'string'),

    preparedAttachmentHashes: {}

  }))

}));



describe('runVisionQueue', () => {

  beforeEach(() => {

    clearRunVisionQueue('run-1');

    vi.mocked(prepareVisionParts).mockReset();

    vi.mocked(prepareVisionParts).mockImplementation(async ({ attachmentMeta }) => ({

      parts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],

      visionTokenEstimate: 0,

      preparedWorkspacePaths: attachmentMeta

        .map((m) => m.workspacePath)

        .filter((p): p is string => typeof p === 'string'),

      preparedAttachmentHashes: {}

    }));

  });



  it('dedupes queued workspace vision paths', () => {

    queueWorkspaceVision('run-1', { path: 'img.png', kind: 'image', source: 'read' });

    queueWorkspaceVision('run-1', { path: 'img.png', kind: 'image', source: 'read' });

    queueWorkspaceVision('run-1', { path: 'other.png', kind: 'image', source: 'capture' });

  });



  it('flush builds a synthetic user message and clears the queue', async () => {

    queueWorkspaceVision('run-1', { path: '.vyotiq/captures/a.png', kind: 'image', source: 'capture' });

    const msg = await flushVisionQueue({

      runId: 'run-1',

      workspacePath: '/ws',

      selection: { providerId: 'p', modelId: 'm' },

      inputModalities: ['text', 'image']

    });

    expect(msg?.role).toBe('user');

    expect(Array.isArray(msg?.content)).toBe(true);

    const textPart = (msg!.content as Array<{ type: string; text?: string }>).find(

      (p) => p.type === 'text'

    );

    expect(textPart?.text).toContain('tool_vision');

    const again = await flushVisionQueue({

      runId: 'run-1',

      workspacePath: '/ws',

      selection: { providerId: 'p', modelId: 'm' }

    });

    expect(again).toBeNull();

  });



  it('restores the queue when prepareVisionParts throws', async () => {

    vi.mocked(prepareVisionParts).mockRejectedValueOnce(new Error('sharp failed'));

    queueWorkspaceVision('run-1', { path: 'img.png', kind: 'image', source: 'read' });



    await expect(

      flushVisionQueue({

        runId: 'run-1',

        workspacePath: '/ws',

        selection: { providerId: 'p', modelId: 'm' }

      })

    ).rejects.toThrow('sharp failed');



    const retry = await flushVisionQueue({

      runId: 'run-1',

      workspacePath: '/ws',

      selection: { providerId: 'p', modelId: 'm' },

      inputModalities: ['text', 'image']

    });

    expect(retry).not.toBeNull();

  });



  it('only emits tool_vision refs for prepared paths', async () => {

    vi.mocked(prepareVisionParts).mockResolvedValueOnce({

      parts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],

      visionTokenEstimate: 0,

      preparedWorkspacePaths: ['ready.png'],

      preparedAttachmentHashes: { 'ready.png': 'abc123' }

    });

    queueWorkspaceVision('run-1', { path: 'ready.png', kind: 'image', source: 'read' });

    queueWorkspaceVision('run-1', { path: 'skipped.pdf', kind: 'pdf', source: 'read' });



    const msg = await flushVisionQueue({

      runId: 'run-1',

      workspacePath: '/ws',

      selection: { providerId: 'p', modelId: 'm' },

      inputModalities: ['text', 'image', 'file']

    });

    const textPart = (msg!.content as Array<{ type: string; text?: string }>).find(

      (p) => p.type === 'text'

    );

    expect(textPart?.text).toContain('ready.png');

    expect(textPart?.text).not.toContain('skipped.pdf');



    const retry = await flushVisionQueue({

      runId: 'run-1',

      workspacePath: '/ws',

      selection: { providerId: 'p', modelId: 'm' },

      inputModalities: ['text', 'file']

    });

    expect(retry?.content).toBeDefined();

  });

  it('flushes queued video and audio when model supports those modalities', async () => {
    vi.mocked(prepareVisionParts).mockResolvedValueOnce({
      parts: [{ type: 'video_url', video_url: { url: 'data:video/mp4;base64,abc' } }],
      visionTokenEstimate: 0,
      preparedWorkspacePaths: ['clip.mp4'],
      preparedAttachmentHashes: { 'clip.mp4': 'vidhash' }
    });
    queueWorkspaceVision('run-1', { path: 'clip.mp4', kind: 'video', source: 'read' });

    const msg = await flushVisionQueue({
      runId: 'run-1',
      workspacePath: '/ws',
      selection: { providerId: 'p', modelId: 'm' },
      inputModalities: ['text', 'video']
    });
    const textPart = (msg!.content as Array<{ type: string; text?: string }>).find(
      (p) => p.type === 'text'
    );
    expect(textPart?.text).toContain('clip.mp4');
    expect(textPart?.text).toContain('kind="video"');
  });

});


