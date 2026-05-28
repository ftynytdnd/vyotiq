/**
 * Report tool live streaming contract — partial args + diffStream render
 * green `+` lines with streaming cursor when expanded.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ReportInvocation } from '@renderer/components/timeline/tools/ReportInvocation';
import type { ToolCall } from '@shared/types/tool';
import type { DiffStreamSnapshot } from '@renderer/components/timeline/reducer/types';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';

const REPORT_HUNKS = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: '+' as const, text: '<html>' },
      { kind: '+' as const, text: '<body>Survey</body>' },
      { kind: '+' as const, text: '</html>' }
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

describe('ReportInvocation — live streaming', () => {
  it('renders diffStream body with partial variant and trailing stream cursor', () => {
    const call: ToolCall = {
      id: 'c-report',
      name: 'report',
      args: { title: 'Survey', body: '<html>\n<body>Survey</body>\n</html>' }
    };
    const diffStream: DiffStreamSnapshot = {
      tool: 'report',
      filePath: '.vyotiq/reports/survey-preview.html',
      hunks: REPORT_HUNKS,
      additions: 3,
      deletions: 0,
      settled: false,
      ts: 1
    };
    const { container } = render(
      <ReportInvocation call={call} partial diffStream={diffStream} rowKey="inv:c-report" />
    );
    fireEvent.click(container.querySelector('button')!);

    expect(container.querySelector('[data-variant="partial"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('streaming report');
    expect(container.querySelector('.vyotiq-stream-cursor')).toBeNull();
  });

  it('renders renderer-side preview when diffStream is absent', () => {
    const call: ToolCall = {
      id: 'c-report-2',
      name: 'report',
      args: { title: 'T', body: 'line one\nline two' }
    };
    const { container } = render(
      <ReportInvocation call={call} partial rowKey="inv:c-report-2" />
    );
    fireEvent.click(container.querySelector('button')!);
    expect(container.querySelector('[data-variant="partial"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('line one');
  });

  it('falls back to renderer-side preview when diffStream has no hunks yet', () => {
    const call: ToolCall = {
      id: 'c-report-empty',
      name: 'report',
      args: { title: 'T', body: 'line one\nline two' }
    };
    const diffStream: DiffStreamSnapshot = {
      tool: 'report',
      filePath: '.vyotiq/reports/t-preview.html',
      hunks: [],
      additions: 0,
      deletions: 0,
      settled: false,
      ts: 1
    };
    const { container } = render(
      <ReportInvocation
        call={call}
        partial
        diffStream={diffStream}
        rowKey="inv:c-report-empty"
      />
    );
    fireEvent.click(container.querySelector('button')!);
    expect(container.querySelector('[data-variant="partial"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('line one');
    expect(container.querySelector('.vyotiq-stream-cursor')).toBeNull();
  });
});
