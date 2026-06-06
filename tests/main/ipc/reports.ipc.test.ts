import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import { registerReportsIpc } from '@main/ipc/reports.ipc';

vi.mock('@main/tools/sandbox.js', () => ({
  realpathInsideWorkspace: vi.fn()
}));
vi.mock('@main/workspace/workspaceState.js', () => ({
  requireWorkspace: vi.fn(async () => '/ws'),
  requireWorkspaceById: vi.fn(async () => '/ws')
}));
vi.mock('@main/window/reportBrowserWindow.js', () => ({
  openReportInAppBrowser: vi.fn(async () => undefined)
}));

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

describe('registerReportsIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects paths outside the workspace sandbox', async () => {
    const { realpathInsideWorkspace } = await import('@main/tools/sandbox.js');
    vi.mocked(realpathInsideWorkspace).mockRejectedValueOnce(new Error('outside workspace'));

    registerReportsIpc();
    const reply = (await mockIpc.__invoke(IPC.REPORTS_OPEN, {
      relPath: '../../../etc/passwd',
      workspaceId: 'w1'
    })) as { ok: boolean; error?: string };

    expect(reply).toEqual({ ok: false, error: 'outside workspace' });
  });

  it('opens sandbox-validated reports in the in-app browser', async () => {
    const { realpathInsideWorkspace } = await import('@main/tools/sandbox.js');
    const { openReportInAppBrowser } = await import('@main/window/reportBrowserWindow.js');
    vi.mocked(realpathInsideWorkspace).mockResolvedValueOnce('/ws/.vyotiq/reports/x.html');

    registerReportsIpc();
    const reply = (await mockIpc.__invoke(IPC.REPORTS_OPEN, {
      relPath: '.vyotiq/reports/x.html',
      workspaceId: 'w1',
      title: 'Run summary'
    })) as { ok: boolean };

    expect(reply).toEqual({ ok: true });
    expect(openReportInAppBrowser).toHaveBeenCalledWith('/ws/.vyotiq/reports/x.html', {
      title: 'Run summary'
    });
  });
});
