/**
 * Regression: Timeline must not short-circuit Zustand hooks with `||`.
 * `useA() || useB()` skips `useB` when `useA` is truthy — React error #311.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline.js';

const attachmentState = vi.hoisted(() => ({ attachment: null as unknown }));

vi.mock('@renderer/store/useAttachmentPreviewStore.js', () => ({
  useAttachmentPreviewStore: (selector: (s: typeof attachmentState) => unknown) =>
    selector(attachmentState)
}));

vi.mock('@renderer/store/useChatStore.js', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      conversationId: 'c-test',
      events: [],
      isProcessing: false,
      partialToolCallArgs: {},
      settledCallIds: {},
      liveDiffByCallId: {},
      assistantTexts: {},
      reasoningTexts: {},
      lastUserPromptContent: undefined,
      send: vi.fn()
    })
}));

vi.mock('@renderer/store/useToastStore.js', () => ({
  useToastStore: (selector: (s: { show: () => void }) => unknown) =>
    selector({ show: vi.fn() })
}));

vi.mock('@renderer/store/useWorkspaceStore.js', () => ({
  useWorkspaceStore: (selector: (s: { activeId: string | null }) => unknown) =>
    selector({ activeId: 'ws-1' })
}));

vi.mock('@renderer/store/useSettingsStore.js', () => ({
  useSettingsStore: (selector: (s: { settings: object }) => unknown) =>
    selector({ settings: {} }),
  selectEffectivePermissions: () => ({})
}));

vi.mock('@renderer/store/useTimelineUiStore.js', () => ({
  useTimelineUiStore: (selector: (s: {
    setTimelineAtTail: () => void;
    scrollToTailRequest: number;
    requestScrollToTail: () => void;
  }) => unknown) =>
    selector({
      setTimelineAtTail: vi.fn(),
      scrollToTailRequest: 0,
      requestScrollToTail: vi.fn()
    })
}));

describe('Timeline hooks', () => {
  it('renders when attachment preview opens without React #311', () => {
    attachmentState.attachment = { path: '/x.txt' };

    const { rerender } = render(<Timeline model={null} />);

    attachmentState.attachment = null;
    expect(() => rerender(<Timeline model={null} />)).not.toThrow();

    attachmentState.attachment = { path: '/y.txt' };
    expect(() => rerender(<Timeline model={null} />)).not.toThrow();

    attachmentState.attachment = null;
  });
});
