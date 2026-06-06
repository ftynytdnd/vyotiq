/**
 * ReportInvocation — title, path, and open action smoke.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportInvocation } from '@renderer/components/timeline/tools/report/ReportInvocation.js';

vi.mock('@renderer/lib/openPath.js', () => ({
  openWorkspaceFile: vi.fn(async () => true)
}));

describe('ReportInvocation', () => {
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
    expect(screen.getByRole('button', { name: /Open in browser/i })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Expand report tool details/i }));
    expect(screen.getByText('.vyotiq/reports/q1-summary.html')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Open in browser/i }));
    expect(openWorkspaceFile).toHaveBeenCalledWith(
      '.vyotiq/reports/q1-summary.html',
      expect.objectContaining({ context: 'report' })
    );
  });
});
