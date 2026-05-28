/**
 * Sub-agent report live streaming — end-to-end via SubAgentRunFlow.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import { SubAgentRunFlow } from '@renderer/components/timeline/subagent/SubAgentRunFlow';
import { SubAgentTrace } from '@renderer/components/timeline/subagent/SubAgentTrace';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import type { TimelineEvent } from '@shared/types/chat';

const SUBAGENT_ID = 'sa-report';
const CALL_ID = 'c-report';
const BODY = '<html>\n<body>Health Survey</body>\n</html>';

beforeEach(() => {
  useChatStore.setState({ conversationId: 'c-test' });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

function buildReportSnapshot() {
  let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, {
    kind: 'subagent-spawn',
    id: 'sp-1',
    ts: 1,
    subagentId: SUBAGENT_ID,
    task: 'Create report',
    files: [],
    tools: ['report']
  });
  s = applyTimelineEvent(s, {
    kind: 'tool-call-args-delta',
    id: 'd1',
    ts: 2,
    callId: CALL_ID,
    name: 'report',
    index: 0,
    argsBuf: JSON.stringify({ title: 'Health Survey', body: BODY }),
    subagentId: SUBAGENT_ID
  });
  const diffStream: Extract<TimelineEvent, { kind: 'diff-stream' }> = {
    kind: 'diff-stream',
    id: 'ds-1',
    ts: 3,
    callId: CALL_ID,
    tool: 'report',
    filePath: '.vyotiq/reports/health-survey-preview.html',
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: '+', text: '<html>' },
          { kind: '+', text: '<body>Health Survey</body>' },
          { kind: '+', text: '</html>' }
        ]
      }
    ],
    additions: 3,
    deletions: 0,
    subagentId: SUBAGENT_ID
  };
  s = applyTimelineEvent(s, diffStream);
  return s.subagents[SUBAGENT_ID]!;
}

describe('sub-agent report live streaming', () => {
  it('SubAgentRunFlow auto-expands report tool-group with streaming hunks', () => {
    const snap = buildReportSnapshot();
    const { container } = render(<SubAgentRunFlow snap={snap} />);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent ?? '').toContain('Health Survey');
    expect(container.querySelector('[data-variant="partial"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('streaming report');
  });

  it('SubAgentTrace auto-expands while report diff is in flight', () => {
    const snap = buildReportSnapshot();
    useChatStore.setState({ subagents: { [SUBAGENT_ID]: snap } });
    const { container } = render(<SubAgentTrace subagentId={SUBAGENT_ID} nested />);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
  });
});
