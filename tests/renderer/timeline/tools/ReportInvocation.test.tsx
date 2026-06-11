/**
 * ReportInvocation — title, path, and open action smoke.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportInvocation } from '@renderer/components/timeline/tools/report/ReportInvocation.js';
import { __test_resetReportAutoOpenSession } from '@renderer/components/timeline/tools/report/reportAutoOpenSession.js';

vi.mock('@renderer/lib/openPath.js', () => ({
  openWorkspaceFile: vi.fn(async () => true)
}));

let autoOpenReports = false;
let liveReportResultIds: Record<string, true> = {};

vi.mock('@renderer/store/useSettingsStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/store/useSettingsStore.js')>();
  return {
    ...actual,
    useSettingsStore: (sel: (s: { settings: { ui?: object } }) => unknown) =>
      sel({ settings: { ui: { reports: { autoOpenReports } } } })
  };
});

vi.mock('@renderer/store/useChatStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/store/useChatStore.js')>();
  return {
    ...actual,
    useChatStore: (sel: (s: { conversationId: string | null; liveReportResultIds: Record<string, true> }) => unknown) =>
      sel({ conversationId: 'conv-1', liveReportResultIds })
  };
});

describe('ReportInvocation', () => {
  beforeEach(() => {
    autoOpenReports = false;
    liveReportResultIds = {};
    __test_resetReportAutoOpenSession();
  });

  it('does not auto-open historical reports on transcript mount', async () => {
    autoOpenReports = true;
    const { openWorkspaceFile } = await import('@renderer/lib/openPath.js');

    render(
      <ReportInvocation
        result={{
          id: 'r-historical',
          name: 'report',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: {
            tool: 'report',
            title: 'Documentation Map',
            relPath: '.vyotiq/reports/docs.html',
            bytes: 100
          }
        }}
        rowKey="report:historical"
      />
    );

    expect(openWorkspaceFile).not.toHaveBeenCalled();
  });

  it('auto-opens when a report settles live during the session', async () => {
    autoOpenReports = true;
    liveReportResultIds = { 'r-auto': true };
    const { openWorkspaceFile } = await import('@renderer/lib/openPath.js');

    render(
      <ReportInvocation
        result={{
          id: 'r-auto',
          name: 'report',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: {
            tool: 'report',
            title: 'Auto Report',
            relPath: '.vyotiq/reports/auto.html',
            bytes: 100
          }
        }}
        rowKey="report:auto"
      />
    );

    expect(openWorkspaceFile).toHaveBeenCalledWith(
      '.vyotiq/reports/auto.html',
      expect.objectContaining({ kind: 'report', context: 'report-auto', title: 'Auto Report' })
    );
  });

  it('renders saved report path and open action on success', async () => {
    const { openWorkspaceFile } = await import('@renderer/lib/openPath.js');

    render(
      <ReportInvocation
        call={{
          id: 'c1',
          name: 'report',
          args: { title: 'Q1 Summary', body: '<p>x</p>' }
        }}
        result={{
          id: 'r1',
          name: 'report',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: {
            tool: 'report',
            title: 'Q1 Summary',
            relPath: '.vyotiq/reports/q1-summary.html',
            bytes: 1200
          }
        }}
        rowKey="report:c1"
      />
    );

    expect(screen.getByText(/Q1 Summary/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open report/i })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Expand report tool details/i }));
    expect(screen.getByText('.vyotiq/reports/q1-summary.html')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Open report/i }));
    expect(openWorkspaceFile).toHaveBeenCalledWith(
      '.vyotiq/reports/q1-summary.html',
      expect.objectContaining({ kind: 'report', context: 'report' })
    );
  });
});
