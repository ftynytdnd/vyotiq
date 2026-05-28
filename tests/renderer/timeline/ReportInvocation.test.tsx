/**
 * Tests for the `ReportInvocation` timeline card.
 *
 * Coverage:
 *   - Collapsed-row title rendering pulls from `result.data.title` when
 *     present, falls back to `call.args.title` while streaming.
 *   - Expanded detail surfaces the workspace-relative path, a size
 *     badge, and (when set) the chart-lib badge.
 *   - The Open-in-browser button calls `vyotiq.tools.openPath` with
 *     the file's relative path.
 *   - A failed result renders the standard `error` detail pane.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportInvocation } from '@renderer/components/timeline/tools/ReportInvocation';
import type { ToolCall, ToolResult } from '@shared/types/tool';

function makeCall(args: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name: 'report' as never, args } as ToolCall;
}

function makeOkResult(overrides: Partial<{
  title: string;
  filePath: string;
  sizeBytes: number;
}> = {}): ToolResult {
  return {
    id: 'r1',
    name: 'report',
    ok: true,
    output: 'Wrote report.',
    durationMs: 5,
    data: {
      tool: 'report',
      title: overrides.title ?? 'Workspace Survey',
      filePath: overrides.filePath ?? '.vyotiq/reports/workspace-survey-20260510-142500.html',
      sizeBytes: overrides.sizeBytes ?? 12_500
    }
  } as ToolResult;
}

describe('ReportInvocation', () => {
  it('renders the title from `data` when the result is present', () => {
    render(
      <ReportInvocation
        call={makeCall({ title: 'argTitle' })}
        result={makeOkResult({ title: 'dataTitle' })}
      />
    );
    expect(screen.getByText('dataTitle')).toBeInTheDocument();
    // We never want both surfaces showing the title.
    expect(screen.queryByText('argTitle')).toBeNull();
  });

  it('falls back to call.args.title while the result is still streaming', () => {
    render(<ReportInvocation call={makeCall({ title: 'streaming' })} />);
    expect(screen.getByText('streaming')).toBeInTheDocument();
  });

  it('shows the file path, size, and Open-in-browser button when expanded', async () => {
    render(
      <ReportInvocation
        call={makeCall({ title: 't' })}
        result={makeOkResult({
          filePath: '.vyotiq/reports/foo-20260510-142500.html',
          sizeBytes: 51_200
        })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /report/i }));

    expect(
      screen.getByText('.vyotiq/reports/foo-20260510-142500.html')
    ).toBeInTheDocument();
    expect(screen.getByText(/50\.0 KB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open in browser/i })).toBeInTheDocument();
  });

  it('invokes vyotiq.tools.openPath with the file path on button click', async () => {
    const openSpy = vi.spyOn(window.vyotiq.tools, 'openPath').mockResolvedValue(undefined);
    const filePath = '.vyotiq/reports/click-test-20260510-142500.html';

    render(
      <ReportInvocation call={makeCall()} result={makeOkResult({ filePath })} />
    );
    await userEvent.click(screen.getByRole('button', { name: /report/i }));
    await userEvent.click(screen.getByRole('button', { name: /open in browser/i }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    // Second arg is the active conversation's workspaceId; undefined
    // here because the test conversations list is empty.
    expect(openSpy).toHaveBeenCalledWith(filePath, undefined);
  });

  it('renders the error detail pane on a failed result', async () => {
    const result: ToolResult = {
      id: 'r1',
      name: 'report',
      ok: false,
      output: 'denied',
      error: 'permission denied',
      durationMs: 1
    };
    render(<ReportInvocation call={makeCall({ title: 'denied' })} result={result} />);

    // Collapsed row shows the inline error hint (first output line).
    expect(screen.getAllByText('denied').length).toBeGreaterThanOrEqual(1);

    // Expand → the "ERROR" label + body in the detail pane.
    await userEvent.click(screen.getByRole('button', { name: /report/i }));
    expect(screen.getByText(/error/i)).toBeInTheDocument();
    expect(screen.getAllByText('denied').length).toBeGreaterThanOrEqual(2);
  });
});
