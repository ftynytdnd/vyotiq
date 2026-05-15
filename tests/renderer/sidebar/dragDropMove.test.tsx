/**
 * Sidebar drag-and-drop — moves a conversation between workspace groups.
 *
 * Covers the wiring between:
 *   - The draggable `Row` in `ChatHistoryList` (sets `CONV_DRAG_MIME`
 *     payload + plaintext fallback).
 *   - The drop target on `WorkspaceGroup` (validates MIME presence,
 *     calls `move(id, ws.id)`).
 *
 * The store-level optimistic-flip + rollback path is exercised in
 * `tests/renderer/conversations/move.test.ts`. This file's job is to
 * pin the DOM-level contract: a drop fires only when the payload
 * carries our custom MIME, and the right id reaches the store.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChatsSection } from '@renderer/components/sidebar/ChatsSection';
import { CONV_DRAG_MIME } from '@renderer/components/sidebar/ChatHistoryList';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { useSidebarSearchStore } from '@renderer/store/useSidebarSearchStore';
import type { ConversationMeta } from '@shared/types/chat';

function meta(over: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'c1',
    title: 'Alpha',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    workspaceId: 'ws-A',
    ...over
  };
}

beforeEach(() => {
  useConversationsStore.setState({
    list: [meta({ id: 'c1', title: 'Alpha', workspaceId: 'ws-A' })],
    activeIdByWorkspace: {},
    hydratedIds: new Set<string>(),
    loading: false
  });
  useWorkspaceStore.setState({
    list: [
      { id: 'ws-A', path: '/tmp/A', label: 'Source', addedAt: 0 },
      { id: 'ws-B', path: '/tmp/B', label: 'Target', addedAt: 0 }
    ],
    activeId: 'ws-A',
    info: { path: '/tmp/A', label: 'Source' },
    loading: false
  });
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
  // Reset transient UI state so a sibling test's open search box / collapsed
  // group doesn't bleed across cases.
  useUiStore.setState({ collapsedWorkspaces: new Set<string>() });
  useSidebarSearchStore.setState({ open: false, query: '' });
});

/**
 * Build a synthetic DataTransfer that mirrors what the platform hands
 * us during a real drag. happy-dom's stock `DataTransfer` doesn't
 * round-trip `setData`/`getData` reliably across `fireEvent` boundaries
 * for custom MIME types, so we hand-roll a minimal stub that the drop
 * handler's guards (`types.includes(...)` + `getData(MIME)`) walk
 * cleanly.
 */
function makeDataTransfer(payload: Record<string, string>): DataTransfer {
  const map = new Map(Object.entries(payload));
  return {
    types: Array.from(map.keys()),
    getData: (mime: string) => map.get(mime) ?? '',
    setData: (mime: string, data: string) => {
      map.set(mime, data);
    },
    dropEffect: 'none',
    effectAllowed: 'all',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    clearData: () => map.clear(),
    setDragImage: () => undefined
  } as unknown as DataTransfer;
}

describe('Sidebar drag-and-drop — conversation move', () => {
  it('drop on a different workspace group invokes useConversationsStore.move with the target id', () => {
    const moveSpy = vi.fn(async () => undefined);
    useConversationsStore.setState({ move: moveSpy as never });

    render(<ChatsSection />);

    // Locate the target workspace group via its rename button label.
    // The whole group is the drop target, so we walk up to the
    // outermost div with the drag handlers attached.
    const targetHeaderBtn = screen.getByRole('button', {
      name: /rename workspace target/i
    });
    // The outer drop target is two levels up: header row → group div.
    // Walk to the nearest ancestor that listens for drops; in our
    // markup that's the element with `aria-busy` set (only present on
    // the WorkspaceGroup root container).
    let group: HTMLElement | null = targetHeaderBtn;
    while (group && group.getAttribute('aria-busy') === null) {
      group = group.parentElement;
    }
    expect(group).not.toBeNull();

    const dt = makeDataTransfer({ [CONV_DRAG_MIME]: 'c1', 'text/plain': 'Alpha' });

    // Realistic sequence: dragenter → dragover → drop. We don't
    // fire dragstart on the source row here because the test seeds
    // the dataTransfer payload directly — the row's onDragStart only
    // matters for the platform-level drag bookkeeping, which happy-
    // dom doesn't simulate end-to-end.
    fireEvent.dragEnter(group as Element, { dataTransfer: dt });
    fireEvent.dragOver(group as Element, { dataTransfer: dt });
    fireEvent.drop(group as Element, { dataTransfer: dt });

    expect(moveSpy).toHaveBeenCalledTimes(1);
    expect(moveSpy).toHaveBeenCalledWith('c1', 'ws-B');
    cleanup();
  });

  it('drop without our custom MIME is ignored (e.g. external file drag)', () => {
    const moveSpy = vi.fn(async () => undefined);
    useConversationsStore.setState({ move: moveSpy as never });

    render(<ChatsSection />);
    const targetHeaderBtn = screen.getByRole('button', {
      name: /rename workspace target/i
    });
    let group: HTMLElement | null = targetHeaderBtn;
    while (group && group.getAttribute('aria-busy') === null) {
      group = group.parentElement;
    }
    expect(group).not.toBeNull();

    // Only `text/plain` — no `application/x-vyotiq-conv-id`. The drop
    // handler's MIME guard must short-circuit so an external drag
    // doesn't accidentally call `move()` with whatever string the
    // platform put on the clipboard.
    const dt = makeDataTransfer({ 'text/plain': 'arbitrary' });

    fireEvent.dragEnter(group as Element, { dataTransfer: dt });
    fireEvent.dragOver(group as Element, { dataTransfer: dt });
    fireEvent.drop(group as Element, { dataTransfer: dt });

    expect(moveSpy).not.toHaveBeenCalled();
    cleanup();
  });
});
