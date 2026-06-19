import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { prepareVisionParts } from '@main/attachments/prepareMediaForVision.js';
import { VISION_IMAGE_MAX_LONG_EDGE } from '@shared/constants.js';

describe('prepareVisionParts', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-vision-'));
    await mkdir(join(workspace, 'assets'), { recursive: true });
    const large = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: { r: 20, g: 40, b: 80 }
      }
    })
      .png()
      .toBuffer();
    await writeFile(join(workspace, 'assets', 'wide.png'), large);
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('resizes and encodes workspace images for vision-capable models', async () => {
    const { parts, visionTokenEstimate, preparedAttachmentHashes } = await prepareVisionParts({
      attachmentMeta: [
        {
          id: 'a1',
          name: 'wide.png',
          mimeType: 'image/png',
          workspacePath: 'assets/wide.png',
          mediaKind: 'image'
        }
      ],
      workspacePath: workspace,
      inputModalities: ['text', 'image']
    });

    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe('image_url');
    if (parts[0]?.type !== 'image_url') return;
    expect(parts[0].image_url.url).toMatch(/^data:image\/(jpeg|png|webp);base64,/);
    expect(visionTokenEstimate).toBeGreaterThan(0);
    expect(preparedAttachmentHashes['assets/wide.png']).toMatch(/^[a-f0-9]{64}$/);

    const meta = await sharp(
      Buffer.from(parts[0].image_url.url.split(',')[1] ?? '', 'base64')
    ).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
      VISION_IMAGE_MAX_LONG_EDGE
    );
  });

  it('skips images when model lacks vision', async () => {
    const { parts, visionTokenEstimate } = await prepareVisionParts({
      attachmentMeta: [
        {
          id: 'a1',
          name: 'wide.png',
          mimeType: 'image/png',
          workspacePath: 'assets/wide.png',
          mediaKind: 'image'
        }
      ],
      workspacePath: workspace,
      inputModalities: ['text']
    });
    expect(parts).toHaveLength(0);
    expect(visionTokenEstimate).toBe(0);
  });

  it('reuses disk cache via preparedMediaHash without re-reading the file', async () => {
    const first = await prepareVisionParts({
      attachmentMeta: [
        {
          id: 'a1',
          name: 'wide.png',
          mimeType: 'image/png',
          workspacePath: 'assets/wide.png',
          mediaKind: 'image'
        }
      ],
      workspacePath: workspace,
      inputModalities: ['text', 'image']
    });
    const hash = first.preparedAttachmentHashes['assets/wide.png'];
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    const second = await prepareVisionParts({
      attachmentMeta: [
        {
          id: 'a2',
          name: 'wide.png',
          mimeType: 'image/png',
          workspacePath: 'assets/wide.png',
          mediaKind: 'image',
          preparedMediaHash: hash
        }
      ],
      workspacePath: workspace,
      inputModalities: ['text', 'image']
    });
    expect(second.parts).toHaveLength(1);
    expect(second.parts[0]).toEqual(first.parts[0]);
  });
});
