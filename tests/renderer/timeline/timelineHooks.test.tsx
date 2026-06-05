/**
 * Regression: Timeline must not short-circuit Zustand hooks with `||`.
 * `useA() || useB()` skips `useB` when `useA` is truthy — React error #311.
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline.js';

const attachmentState = vi.hoisted(() => ({ attachment: null as unknown }));
const liveDiffState = vi.hoisted(() => ({ target: null as unknown }));

vi.mock('@renderer/store/useAttachmentPreviewStore.js', () => ({
  useAttachmentPreviewStore: (selector: (s: typeof attachmentState) => unknown) =>
    selector(attachmentState)
}));

vi.mock('@renderer/store/useFloatingLiveDiffStore.js', () => ({
  useFloatingLiveDiffStore: (selector: (s: typeof liveDiffState) => unknown) =>
    selector(liveDiffState)
}));

vi.mock('@renderer/store/useChatStore.js', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
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
  useTimelineUiStore: (selector: (s: { setTimelineAtTail: () => void }) => unknown) =>
    selector({ setTimelineAtTail: vi.fn() })
}));

vi.mock('@renderer/components/timeline/hooks/useFloatingLiveDiffAutoOpen.js', () => ({
  useFloatingLiveDiffAutoOpen: vi.fn()
}));

describe('Timeline hooks', () => {
  it('renders when attachment preview opens without React #311', () => {
    attachmentState.attachment = { path: '/x.txt' };
    liveDiffState.target = null;

    const { container, rerender } = render(<Timeline model={null} />);
    expect(container.querySelector('[data-row-kind]')).toBeDefined();

    attachmentState.attachment = null;
    liveDiffState.target = { callId: 'c1', filePath: 'a.ts', diffStream: { hunks: [] } };
    expect(() => rerender(<Timeline model={null} />)).not.toThrow();

    attachmentState.attachment = { path: '/y.txt' };
    liveDiffState.target = { callId: 'c2', filePath: 'b.ts', diffStream: { hunks: [] } };
    expect(() => rerender(<Timeline model={null} />)).not.toThrow();

    attachmentState.attachment = null;
    liveDiffState.target = null;
  });
});
