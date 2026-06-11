import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import {
  applyTimelineEvent,
  rebuildTimelineState
} from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

const reportResult: TimelineEvent = {
  kind: 'tool-result',
  id: 'tr-1',
  ts: 2,
  result: {
    id: 'tc-report',
    name: 'report',
    ok: true,
    output: 'ok',
    durationMs: 1,
    data: {
      tool: 'report',
      title: 'Documentation Map',
      relPath: '.vyotiq/reports/map.html',
      bytes: 100
    }
  }
};

describe('liveReportResultIds', () => {
  it('marks report tool-results on live apply only', () => {
    const live = applyTimelineEvent(INITIAL_TIMELINE_STATE, reportResult);
    expect(live.liveReportResultIds).toEqual({ 'tc-report': true });
  });

  it('does not mark report tool-results during transcript replay', () => {
    const replayed = rebuildTimelineState([
      {
        kind: 'user-prompt',
        id: 'p1',
        ts: 1,
        content: 'Write docs'
      },
      reportResult
    ]);
    expect(replayed.liveReportResultIds).toEqual({});
  });
});
