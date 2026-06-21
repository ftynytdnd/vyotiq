/**
 * `useComposerAttachments` — clipboard paste routing (host path vs image bytes).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { useComposerAttachments } from '@renderer/components/composer/useComposerAttachments';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useToastStore } from '@renderer/store/useToastStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';

const ingestClipboardImage = vi.fn<[], Promise<PromptAttachmentMeta | null>>();
const ingestPaths = vi.fn<[], Promise<PromptAttachmentMeta[]>>();
const pick = vi.fn<[], Promise<PromptAttachmentMeta[]>>();

const ingestClipboard = vi.fn<[], Promise<PromptAttachmentMeta[]>>();

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
  const items = types.map((type, index) => ({
    type,
    kind: 'file' as const,
    getAsFile: () => files[index] ?? null
  }));
  const fileList = Object.assign([...files], {
    item: (index: number) => files[index] ?? null
  });
  return {
    preventDefault,
    clipboardData: {
      files: fileList as unknown as FileList,
      items: items as unknown as DataTransferItemList,
      getData: (format: string) => (format === 'text/plain' ? '' : '')
    }
  } as unknown as React.ClipboardEvent<HTMLElement>;
}

beforeEach(() => {
  ingestClipboardImage.mockReset();
  ingestPaths.mockReset();
  pick.mockReset();
  ingestClipboard.mockReset();
  ingestClipboardImage.mockResolvedValue(clipboardAttach);
  ingestClipboard.mockResolvedValue([pathAttach]);
  ingestPaths.mockResolvedValue([pathAttach]);
  pick.mockResolvedValue([]);

  for (const t of useToastStore.getState().toasts) {
    useToastStore.getState().dismiss(t.id);
  }

  Object.assign(window.vyotiq as object, {
    attachments: {
      pick,
      collectFolder: vi.fn(async () => ({ paths: [], total: 0, truncated: false })),
      ingestPaths,
      ingestClipboardImage,
      ingestClipboard,
      readText: vi.fn(async () => ''),
      fileUrl: vi.fn(async () => ''),
      open: vi.fn(async () => undefined)
    }
  });

  useWorkspaceStore.setState({
    info: { path: 'C:\\tmp\\agent' }
  } as never);

  useConversationsStore.setState({
    ensureConversationForAttachments: vi.fn(async () => null)
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
      expect(ingestClipboard).toHaveBeenCalledOnce();
    });
    expect(pick).not.toHaveBeenCalled();
    expect(ingestPaths).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.attachments).toEqual([pathAttach]);
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
      expect(ingestClipboard).toHaveBeenCalledOnce();
    });
    expect(ingestClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        messageId: expect.any(String),
        blobs: expect.any(Array)
      })
    );
    expect(pick).not.toHaveBeenCalled();
    expect(ingestPaths).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.attachments).toEqual([pathAttach]);
    });
  });

  it('ingests non-image clipboard blobs without host path', async () => {
    const { result } = renderHook(() => useComposerAttachments(session));
    const file = new File([new Uint8Array(8)], 'notes.txt', { type: 'text/plain' });
    const event = makeClipboardPasteEvent([file]);

    act(() => {
      result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(ingestClipboard).toHaveBeenCalledOnce();
    });
    expect(pick).not.toHaveBeenCalled();
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

  it('falls back to clipboard blobs when stale host path metadata fails ingest', async () => {
    ingestPaths.mockResolvedValue([]);
    const { result } = renderHook(() => useComposerAttachments(session));
    const file = Object.assign(
      new File([new Uint8Array([1, 2, 3])], 'clip.png', { type: 'image/png' }),
      { path: 'C:\\review-bugbot' }
    );
    const event = makeClipboardPasteEvent([file]);

    act(() => {
      result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(ingestPaths).toHaveBeenCalledOnce();
      expect(ingestClipboard).toHaveBeenCalledOnce();
    });
    expect(ingestPaths).toHaveBeenCalledWith({
      paths: ['C:\\review-bugbot'],
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      messageId: expect.any(String)
    });
    await waitFor(() => {
      expect(result.current.attachments).toEqual([pathAttach]);
    });
  });

  it('toasts when pasting without an active workspace or conversation', async () => {
    const { result } = renderHook(() => useComposerAttachments({ conversationId: null, workspaceId: null }));
    const event = makeClipboardPasteEvent([], ['image/png']);

    act(() => {
      result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
    expect(useToastStore.getState().toasts[0]?.message).toBe(
      'Open a workspace before attaching files.'
    );
    expect(ingestClipboard).not.toHaveBeenCalled();
  });

  it('ensures a conversation when workspace is open but mirror is empty', async () => {
    const ensureConversationForAttachments = vi.fn(async () => 'conv-ensured');
    useConversationsStore.setState({ ensureConversationForAttachments } as never);

    const { result } = renderHook(() =>
      useComposerAttachments({ conversationId: null, workspaceId: 'ws-1' })
    );
    const event = makeClipboardPasteEvent([], ['image/png']);

    act(() => {
      result.current.onPaste(event);
    });

    await waitFor(() => {
      expect(ensureConversationForAttachments).toHaveBeenCalledWith('ws-1');
      expect(ingestClipboard).toHaveBeenCalledOnce();
    });
    expect(ingestClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        conversationId: 'conv-ensured'
      })
    );
  });
});
