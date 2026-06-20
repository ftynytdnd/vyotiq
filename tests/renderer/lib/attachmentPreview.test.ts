import { describe, expect, it } from 'vitest';
import {
  attachmentPreviewKind,
  canPreviewAttachmentInApp
} from '@renderer/lib/attachmentPreview';

describe('attachmentPreview', () => {
  it('classifies video attachments for in-app preview', () => {
    const meta = {
      id: 'v1',
      name: 'Screen Recording 2026-06-19.mp4',
      workspacePath: 'captures/recording.mp4'
    };
    expect(attachmentPreviewKind(meta)).toBe('video');
    expect(canPreviewAttachmentInApp(meta)).toBe(true);
  });

  it('classifies audio attachments for in-app preview', () => {
    const meta = {
      id: 'a1',
      name: 'clip.mp3',
      mimeType: 'audio/mpeg',
      workspacePath: 'audio/clip.mp3'
    };
    expect(attachmentPreviewKind(meta)).toBe('audio');
    expect(canPreviewAttachmentInApp(meta)).toBe(true);
  });

  it('classifies images by extension when mime is missing', () => {
    const meta = {
      id: 'i1',
      name: 'shot.png',
      workspacePath: 'captures/shot.png'
    };
    expect(attachmentPreviewKind(meta)).toBe('image');
    expect(canPreviewAttachmentInApp(meta)).toBe(true);
  });

  it('classifies PDF attachments', () => {
    const meta = {
      id: 'p1',
      name: 'report.pdf',
      workspacePath: 'docs/report.pdf'
    };
    expect(attachmentPreviewKind(meta)).toBe('pdf');
    expect(canPreviewAttachmentInApp(meta)).toBe(true);
  });

  it('classifies text/code attachments', () => {
    const meta = {
      id: 't1',
      name: 'main.py',
      workspacePath: 'main.py'
    };
    expect(attachmentPreviewKind(meta)).toBe('text');
    expect(canPreviewAttachmentInApp(meta)).toBe(true);
  });

  it('rejects unknown binary attachments', () => {
    const meta = {
      id: 'b1',
      name: 'archive.zip',
      mimeType: 'application/zip',
      workspacePath: 'archive.zip'
    };
    expect(attachmentPreviewKind(meta)).toBe('none');
    expect(canPreviewAttachmentInApp(meta)).toBe(false);
  });
});
