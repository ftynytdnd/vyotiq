/**
 * Reducer-level pin for `runIdToFileEditCount`.
 *
 * The slot drives the inline numeric badge on `UserPromptRow`'s
 * Revert action. It must:
 *   - increment for every orchestrator-level `file-edit` carrying a
 *     non-empty `runId`,
 *   - increment for every sub-agent `file-edit` carrying the parent
 *     run's `runId` (sub-agent edits inherit the parent run's id
 *     upstream so the count captures the FULL turn impact),
 *   - leave the slot untouched when `runId` is absent (legacy
 *     transcripts persisted before the field was added),
 *   - survive `rebuildTimelineState` so transcript replays reproduce
 *     the same counts post-reload.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTimelineEvent,
  rebuildTimelineState
} from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

function fileEdit(
  partial: Partial<Extract<TimelineEvent, { kind: 'file-edit' }>>
): Extract<TimelineEvent, { kind: 'file-edit' }> {
  return {
    kind: 'file-edit',
    id: partial.id ?? 'fe-1',
    ts: partial.ts ?? 1,
    filePath: partial.filePath ?? 'a.txt',
    additions: partial.additions ?? 1,
    deletions: partial.deletions ?? 0,
    ...(partial.runId !== undefined ? { runId: partial.runId } : {}),
    ...(partial.subagentId !== undefined ? { subagentId: partial.subagentId } : {})
  };
}

describe('runIdToFileEditCount', () => {
  it('increments per orchestrator-level file-edit with a runId', () => {
    let state = INITIAL_TIMELINE_STATE;
    state = applyTimelineEvent(state, fileEdit({ id: 'fe-1', runId: 'run-A' }));
    state = applyTimelineEvent(state, fileEdit({ id: 'fe-2', runId: 'run-A' }));
    expect(state.runIdToFileEditCount).toEqual({ 'run-A': 2 });
  });

  it('aggregates orchestrator + sub-agent file-edits under the same parent runId', () => {
    let state = INITIAL_TIMELINE_STATE;
    state = applyTimelineEvent(state, fileEdit({ id: 'fe-1', runId: 'run-X' }));
    state = applyTimelineEvent(
      state,
      fileEdit({ id: 'fe-2', runId: 'run-X', subagentId: 'sa-1' })
    );
    state = applyTimelineEvent(
      state,
      fileEdit({ id: 'fe-3', runId: 'run-X', subagentId: 'sa-1' })
    );
    expect(state.runIdToFileEditCount).toEqual({ 'run-X': 3 });
  });

  it('keeps separate runs in separate buckets', () => {
    let state = INITIAL_TIMELINE_STATE;
    state = applyTimelineEvent(state, fileEdit({ id: 'fe-1', runId: 'run-A' }));
    state = applyTimelineEvent(state, fileEdit({ id: 'fe-2', runId: 'run-B' }));
    state = applyTimelineEvent(state, fileEdit({ id: 'fe-3', runId: 'run-B' }));
    expect(state.runIdToFileEditCount).toEqual({ 'run-A': 1, 'run-B': 2 });
  });

  it('leaves the slot untouched when runId is absent (legacy transcripts)', () => {
    let state = INITIAL_TIMELINE_STATE;
    state = applyTimelineEvent(state, fileEdit({ id: 'fe-1' /* no runId */ }));
    state = applyTimelineEvent(state, fileEdit({ id: 'fe-2' /* no runId */ }));
    expect(state.runIdToFileEditCount).toEqual({});
  });

  it('reproduces the same map under rebuildTimelineState (replay parity)', () => {
    const events: TimelineEvent[] = [
      fileEdit({ id: 'fe-1', runId: 'run-A' }),
      fileEdit({ id: 'fe-2', runId: 'run-A', subagentId: 'sa-1' }),
      fileEdit({ id: 'fe-3', runId: 'run-B' }),
      fileEdit({ id: 'fe-4' /* no runId */ })
    ];
    const replayed = rebuildTimelineState(events);
    expect(replayed.runIdToFileEditCount).toEqual({ 'run-A': 2, 'run-B': 1 });
  });
});
