/**
 * `openWorkspaceFile` helper tests.
 *
 * Coverage:
 *   - Forwards `workspaceId` to `vyotiq.tools.openPath` so cross-
 *     workspace opens stay pinned to the artifact's owning workspace.
 *   - Returns `true` on success, `false` on failure.
 *   - Surfaces failures via the toast store rather than throwing.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openWorkspaceFile } from '@renderer/lib/openPath';
import { useToastStore } from '@renderer/store/useToastStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';

const PRISTINE_TOASTS = useToastStore.getState();
function resetToasts() {
  useToastStore.setState(PRISTINE_TOASTS, /* replace */ true);
}

describe('openWorkspaceFile', () => {
  beforeEach(() => {
    resetToasts();
    vi.restoreAllMocks();
    useSettingsStore.setState({
      settings: { ui: { reports: { openInAppBrowser: false } } }
    } as ReturnType<typeof useSettingsStore.getState>);
  });

  it('forwards workspaceId to vyotiq.tools.openPath and returns true on success', async () => {
    const spy = vi
      .spyOn(window.vyotiq.tools, 'openPath')
      .mockResolvedValue(undefined);

    const ok = await openWorkspaceFile('.vyotiq/reports/x.html', {
      workspaceId: 'ws-A',
      context: 'unit-test'
    });

    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledWith('.vyotiq/reports/x.html', 'ws-A');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('omits workspaceId from the IPC arg when not provided', async () => {
    const spy = vi
      .spyOn(window.vyotiq.tools, 'openPath')
      .mockResolvedValue(undefined);

    await openWorkspaceFile('.vyotiq/reports/x.html');

    expect(spy).toHaveBeenCalledWith('.vyotiq/reports/x.html', undefined);
  });

  it('returns false and shows a danger toast when the IPC rejects', async () => {
    vi.spyOn(window.vyotiq.tools, 'openPath').mockRejectedValueOnce(
      new Error('shell.openPath failed')
    );

    const ok = await openWorkspaceFile('.vyotiq/reports/foo-20260101-120000.html', {
      workspaceId: 'ws-A'
    });

    expect(ok).toBe(false);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.tone).toBe('danger');
    expect(toasts[0]?.message).toContain('shell.openPath failed');
    expect(toasts[0]?.message).toContain('.vyotiq/reports/foo-20260101-120000.html');
  });

  it('does not throw \u2014 callers can `await` without a try/catch', async () => {
    vi.spyOn(window.vyotiq.tools, 'openPath').mockRejectedValueOnce(
      new Error('boom')
    );
    await expect(openWorkspaceFile('x.html')).resolves.toBe(false);
  });

  it('routes report opens through vyotiq.reports.open when in-app browser is on', async () => {
    useSettingsStore.setState({
      settings: { ui: { reports: { openInAppBrowser: true } } }
    } as ReturnType<typeof useSettingsStore.getState>);
    const reportsSpy = vi.spyOn(window.vyotiq.reports, 'open').mockResolvedValue({ ok: true });
    const toolsSpy = vi.spyOn(window.vyotiq.tools, 'openPath');

    const ok = await openWorkspaceFile('.vyotiq/reports/x.html', {
      workspaceId: 'ws-A',
      kind: 'report'
    });

    expect(ok).toBe(true);
    expect(reportsSpy).toHaveBeenCalledWith({
      relPath: '.vyotiq/reports/x.html',
      workspaceId: 'ws-A',
      title: undefined
    });
    expect(toolsSpy).not.toHaveBeenCalled();
  });
});
