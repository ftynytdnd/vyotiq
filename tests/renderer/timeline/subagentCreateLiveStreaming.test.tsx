/**
 * Sub-agent live-create streaming \u2014 end-to-end auto-expand contract.
 *
 * The orchestrator NEVER edits, creates, or deletes files; every file
 * operation flows through a sub-agent. So if `DiffStreamer` fails to
 * emit `diff-stream` events for sub-agent file creates, the user sees
 * nothing live \u2014 the rolled-up sub-agent tool group stays collapsed,
 * the renderer-side `EditInvocation` `create-preview` (with the
 * green-tinted `+` lines + trailing `vyotiq-stream-cursor`) is hidden,
 * and the `+N` shimmer badge is the only visible signal.
 *
 * Pre-fix: `DiffStreamer.onArgsDelta` had `if (parsed.create === true)
 * return` as the very first edit-branch check, so the create case
 * silently bypassed the entire emit pipeline.
 *
 * Post-fix: a dedicated `handleCreateDelta` path emits `diff-stream`
 * events with all-`+` hunks against an empty before-body, mirroring
 * what the renderer's `synthesizeCreateHunks` would produce. The
 * downstream auto-expand chain (`partialToolCallArgs[callId].diffStream
 * != null` \u2192 `ToolGroupRow.liveAutoExpand` \u2192
 * `InvocationShell.liveAutoExpand`) lights up exactly the same way it
 * does for modify edits.
 *
 * This test pins the FULL chain end-to-end inside the renderer,
 * starting from an authoritative `applyTimelineEvent` reduce of:
 *
 *   subagent-spawn \u2192 tool-call-args-delta \u2192 diff-stream
 *
 * \u2014 the same event sequence the orchestrator emits over IPC \u2014 and
 * asserts that the resulting `SubAgentSnapshot` produces a
 * `SubAgentRunFlow` whose `ToolGroupRow` auto-expands and reveals the
 * streaming hunks in the DOM.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import { SubAgentRunFlow } from '@renderer/components/timeline/subagent/SubAgentRunFlow';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import type { TimelineEvent } from '@shared/types/chat';
import type { DiffHunk } from '@shared/types/tool';

const SUBAGENT_ID = 'sa-worker-1';
const CALL_ID = 'c-create';
const PATH = 'README.md';
const CONTENT = '# Vyotiq\n\nfreshly\nstreamed\nlines';

// Hunks the main-process `synthesizeCreateHunks` would emit for the
// same content \u2014 every line a `+` line.
const CREATE_HUNKS: DiffHunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: '+', text: '# Vyotiq' },
      { kind: '+', text: '' },
      { kind: '+', text: 'freshly' },
      { kind: '+', text: 'streamed' },
      { kind: '+', text: 'lines' }
    ]
  }
];

beforeEach(() => {
  useChatStore.setState({ conversationId: 'c-test' });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

function buildSnapshot() {
  let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
    kind: 'subagent-spawn',
    id: 'sp-1',
    ts: 1,
    subagentId: SUBAGENT_ID,
    task: 'Create README',
    files: [],
    tools: ['edit']
  });
  // Streaming partial-args delta with `create: true`. Mirrors what
  // `handleDelegates.ts` emits for an in-flight worker tool call.
  s = applyTimelineEvent(s, {
    kind: 'tool-call-args-delta',
    id: 'd1',
    ts: 2,
    callId: CALL_ID,
    name: 'edit',
    index: 0,
    argsBuf: JSON.stringify({ path: PATH, create: true, content: CONTENT }),
    subagentId: SUBAGENT_ID
  });
  // The diff-stream event main now emits for create-true edits.
  // Pre-fix this never landed (`DiffStreamer` short-circuited on
  // `parsed.create === true`).
  const diffStreamEvent: Extract<TimelineEvent, { kind: 'diff-stream' }> = {
    kind: 'diff-stream',
    id: 'ds1',
    ts: 3,
    callId: CALL_ID,
    tool: 'edit',
    filePath: PATH,
    hunks: CREATE_HUNKS,
    additions: 5,
    deletions: 0,
    subagentId: SUBAGENT_ID
  };
  s = applyTimelineEvent(s, diffStreamEvent);
  return s.subagents[SUBAGENT_ID]!;
}

describe('Sub-agent live-create streaming \u2014 end-to-end', () => {
  it('reducer routes the diff-stream into the worker partialToolCallArgs slot', () => {
    const snap = buildSnapshot();
    const entry = snap.partialToolCallArgs[CALL_ID];
    expect(entry).toBeDefined();
    expect(entry!.parsed).toEqual({ path: PATH, create: true, content: CONTENT });
    expect(entry!.diffStream).toBeDefined();
    expect(entry!.diffStream!.hunks).toEqual(CREATE_HUNKS);
    expect(entry!.diffStream!.additions).toBe(5);
    expect(entry!.diffStream!.deletions).toBe(0);
  });

  it('SubAgentRunFlow renders an auto-expanded tool-group with streaming hunks visible', () => {
    const snap = buildSnapshot();
    const { container } = render(<SubAgentRunFlow snap={snap} />);
    // The tool-group header button is the first <button> in the
    // sub-agent flow. It MUST report aria-expanded=true with zero
    // clicks because `partial && diffStream != null` flips
    // `ToolGroupRow.liveAutoExpand`.
    const groupBtn = container.querySelector('button');
    expect(groupBtn).not.toBeNull();
    expect(groupBtn!.getAttribute('aria-expanded')).toBe('true');
    // Every line of the streaming content is in the DOM \u2014 the user
    // sees each line of code in the diff card without clicking.
    expect(container.textContent ?? '').toContain('# Vyotiq');
    expect(container.textContent ?? '').toContain('freshly');
    expect(container.textContent ?? '').toContain('streamed');
    expect(container.textContent ?? '').toContain('lines');
  });

  it('auto-expanded inner EditInvocation shows the streaming `partial` variant with cursor', () => {
    const snap = buildSnapshot();
    const { container } = render(<SubAgentRunFlow snap={snap} />);
    // The diff container surfaces with `data-variant="partial"`
    // (the streaming variant that lights up the trailing
    // `vyotiq-stream-cursor`). Pre-fix this entire subtree never
    // mounted because the parent `ToolGroupRow` stayed collapsed.
    const partialNode = container.querySelector('[data-variant="partial"]');
    expect(partialNode).not.toBeNull();
    // The streaming cursor is mounted \u2014 the visible "live caret"
    // signal. CSS animates the class via `vyotiq-stream-cursor`.
    const cursor = container.querySelector('.vyotiq-stream-cursor');
    expect(cursor).not.toBeNull();
    // The pane label is the friendly "new file streaming\u2026" copy
    // (NOT the modify-path "live diff" label) so the UX is
    // specifically the create-streaming surface.
    expect(container.textContent ?? '').toContain('new file streaming');
  });

  it('auto-collapses on settle when the authoritative tool-call lands without a manual override', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
      kind: 'subagent-spawn',
      id: 'sp-1',
      ts: 1,
      subagentId: SUBAGENT_ID,
      task: 'Create README',
      files: [],
      tools: ['edit']
    });
    s = applyTimelineEvent(s, {
      kind: 'tool-call-args-delta',
      id: 'd1',
      ts: 2,
      callId: CALL_ID,
      name: 'edit',
      index: 0,
      argsBuf: JSON.stringify({ path: PATH, create: true, content: CONTENT }),
      subagentId: SUBAGENT_ID
    });
    s = applyTimelineEvent(s, {
      kind: 'diff-stream',
      id: 'ds1',
      ts: 3,
      callId: CALL_ID,
      tool: 'edit',
      filePath: PATH,
      hunks: CREATE_HUNKS,
      additions: 5,
      deletions: 0,
      subagentId: SUBAGENT_ID
    });
    // Live snapshot: row auto-expanded.
    const liveSnap = s.subagents[SUBAGENT_ID]!;
    const live = render(<SubAgentRunFlow snap={liveSnap} />);
    expect(live.container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    live.unmount();

    // Authoritative tool-call settles. Reducer drops the partial
    // entry (including `diffStream`) and the `tool-result`
    // populates the settled child.
    s = applyTimelineEvent(s, {
      kind: 'tool-call',
      id: 'tc1',
      ts: 4,
      call: {
        id: CALL_ID,
        name: 'edit',
        args: { path: PATH, create: true, content: CONTENT }
      },
      subagentId: SUBAGENT_ID
    });
    s = applyTimelineEvent(s, {
      kind: 'tool-result',
      id: 'tr1',
      ts: 5,
      result: {
        id: CALL_ID,
        name: 'edit',
        ok: true,
        output: '',
        durationMs: 12,
        data: {
          tool: 'edit',
          filePath: PATH,
          additions: 5,
          deletions: 0,
          created: true,
          createdContent: CONTENT
        }
      },
      subagentId: SUBAGENT_ID
    });
    const settledSnap = s.subagents[SUBAGENT_ID]!;
    expect(settledSnap.partialToolCallArgs[CALL_ID]).toBeUndefined();
    const settled = render(<SubAgentRunFlow snap={settledSnap} />);
    // Live signal off, no manual override \u2192 derives back to the
    // persisted `false`. The row collapses on its own so a long
    // multi-create run doesn't leave the transcript pre-expanded.
    expect(settled.container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });
});
