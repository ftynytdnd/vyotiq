/**
 * `useComposerAttachments` — clipboard paste routing (host path vs image bytes).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { useComposerAttachments } from '@renderer/components/composer/useComposerAttachments';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

const ingestClipboardImage = vi.fn<[], Promise<PromptAttachmentMeta | null>>();
const ingestPaths = vi.fn<[], Promise<PromptAttachmentMeta[]>>();
const pick = vi.fn<[], Promise<PromptAttachmentMeta[]>>();

const clipboardAttach: PromptAttachmentMeta = {
  id: 'attach-clip',
  name: 'clip.png',
  mimeType: 'image/png',
  mediaKind: 'image'
};

const pathAttach: PromptAttachmentMeta = {
  id: 'attach-path',
  name: 'doc.pdf',
  mimeType: 'application/pdf',
  workspacePath: 'docs/doc.pdf'
};

function makeClipboardPasteEvent(
  files: Array<File & { path?: string }>,
  itemTypes?: string[]
): React.ClipboardEvent<HTMLElement> {
  const preventDefault = vi.fn();
  const types = itemTypes ?? files.map((f) => f.type);
  const items = types.map((type) => ({ type, kind: 'file' as const }));
  const fileList = Object.assign([...files], {
    item: (index: number) => files[index] ?? null
  });
  return {
    preventDefault,
    clipboardData: {
      files: fileList as unknown as FileList,
      items: items as unknown as DataTransferItemList
    }
  } as unknown as React.ClipboardEvent<HTMLElement>;
}

beforeEach(() => {
  ingestClipboardImage.mockReset();
  ingestPaths.mockReset();
  pick.mockReset();
  ingestClipboardImage.mockResolvedValue(clipboardAttach);
  ingestPaths.mockResolvedValue([pathAttach]);
  pick.mockResolvedValue([]);

  Object.assign(window.vyotiq as object, {
    attachments: {
      pick,
      collectFolder: vi.fn(async () => ({ paths: [], total: 0, truncated: false })),
      ingestPaths,
      ingestClipboardImage,
      readText: vi.fn(async () => ''),
      fileUrl: vi.fn(async () => ''),
      open: vi.fn(async () => undefined)
    }
  });

  useWorkspaceStore.setState({
    info: { path: 'C:\\tmp\\agent' }
  } as never);
});

describe('useComposerAttachments onPaste', () => {
  const session = { conversationId: 'conv-1', workspaceId: 'ws-1' };

  it('ingests clipboard image when items list image/* but files is empty', async () => {
    const { result } = renderHook(() => useComposerAttachments(session));
    const event = makeClipboardPasteEvent([], ['image/png']);

    act(() => {
      result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(ingestClipboardImage).toHaveBeenCalledOnce();
    });
    expect(pick).not.toHaveBeenCalled();
    expect(ingestPaths).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.attachments).toEqual([clipboardAttach]);
    });
  });

  it('ingests clipboard image when pasted file has no host path', async () => {
    const { result } = renderHook(() => useComposerAttachments(session));
    const file = new File([new Uint8Array(8)], 'clip.png', { type: 'image/png' });
    const event = makeClipboardPasteEvent([file]);

    act(() => {
      result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(ingestClipboardImage).toHaveBeenCalledOnce();
    });
    expect(ingestClipboardImage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      messageId: expect.any(String)
    });
    expect(pick).not.toHaveBeenCalled();
    expect(ingestPaths).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.attachments).toEqual([clipboardAttach]);
    });
  });

  it('opens the file picker when pasted file is non-image without host path', async () => {
    const { result } = renderHook(() => useComposerAttachments(session));
    const file = new File([new Uint8Array(8)], 'notes.txt', { type: 'text/plain' });
    const event = makeClipboardPasteEvent([file]);

    act(() => {
      result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(pick).toHaveBeenCalledOnce();
    });
    expect(ingestClipboardImage).not.toHaveBeenCalled();
    expect(ingestPaths).not.toHaveBeenCalled();
  });

  it('ingests host paths when pasted files include Electron path metadata', async () => {
    const { result } = renderHook(() => useComposerAttachments(session));
    const file = Object.assign(new File([], 'doc.pdf', { type: 'application/pdf' }), {
      path: 'C:\\tmp\\agent\\docs\\doc.pdf'
    });
    const event = makeClipboardPasteEvent([file]);

    act(() => {
      result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(ingestPaths).toHaveBeenCalledOnce();
    });
    expect(ingestPaths).toHaveBeenCalledWith({
      paths: ['C:\\tmp\\agent\\docs\\doc.pdf'],
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      messageId: expect.any(String)
    });
    expect(ingestClipboardImage).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.attachments).toEqual([pathAttach]);
    });
  });
});
