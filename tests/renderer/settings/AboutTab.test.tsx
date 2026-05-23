/**
 * `SettingsPanel` → About tab — verifies that the read-only `AppInfo`
 * snapshot from `vyotiq.app.info()` renders into the Build + On-disk
 * paths sections, and that each Reveal button calls `revealPath` with
 * the matching whitelisted target enum (`'userData'` | `'settings'` |
 * `'log'`).
 *
 * The renderer setup in `tests/setup/rendererSetup.ts` already provides
 * a `vyotiq.app` stub that returns a fixed snapshot; we override it
 * here when we need to drive a specific value.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '@renderer/components/settings/SettingsPanel';
import type { AppInfo } from '@shared/types/ipc';

const fixture: AppInfo = {
  version: '1.2.3',
  electron: '28.2.0',
  node: '18.18.2',
  userDataDir: 'C:/Users/test/AppData/Roaming/Vyotiq',
  settingsFile: 'C:/Users/test/AppData/Roaming/Vyotiq/settings.json',
  logDir: 'C:/Users/test/AppData/Roaming/Vyotiq/vyotiq/logs'
};

function stubAppInfo(): void {
  // The renderer test setup hands us a stub `vyotiq.app`; we override
  // `info` here so the assertions can target the fixture values.
  window.vyotiq.app.info = vi.fn(async () => fixture) as never;
}

describe('SettingsPanel → About tab', () => {
  it('renders version, electron, and node lines from app.info()', async () => {
    stubAppInfo();
    render(<SettingsPanel initialTab="about" />);

    // Each `<dt>` ↔ `<dd>` pair lives inside a definition list; we
    // assert on the visible value rather than the label so the test
    // ignores label punctuation / casing drift over time.
    await waitFor(() => {
      expect(screen.getByText(fixture.version)).toBeInTheDocument();
    });
    expect(screen.getByText(fixture.electron)).toBeInTheDocument();
    expect(screen.getByText(fixture.node)).toBeInTheDocument();
  });

  it('renders each on-disk path with a Reveal button wired to the matching target', async () => {
    stubAppInfo();
    const revealSpy = vi.fn(async () => undefined);
    window.vyotiq.app.revealPath = revealSpy as never;

    render(<SettingsPanel initialTab="about" />);

    await waitFor(() => {
      expect(screen.getByText(fixture.userDataDir)).toBeInTheDocument();
    });
    expect(screen.getByText(fixture.settingsFile)).toBeInTheDocument();
    expect(screen.getByText(fixture.logDir)).toBeInTheDocument();

    // Three Reveal buttons — one per path. We click each one and
    // verify the IPC call carries the whitelisted enum target.
    const buttons = screen.getAllByRole('button', { name: /Reveal/ });
    expect(buttons).toHaveLength(3);

    await userEvent.click(buttons[0]!);
    await userEvent.click(buttons[1]!);
    await userEvent.click(buttons[2]!);

    expect(revealSpy).toHaveBeenCalledTimes(3);
    expect(revealSpy).toHaveBeenNthCalledWith(1, 'userData');
    expect(revealSpy).toHaveBeenNthCalledWith(2, 'settings');
    expect(revealSpy).toHaveBeenNthCalledWith(3, 'log');
  });

  it('shows a fallback message when app.info() rejects', async () => {
    window.vyotiq.app.info = vi.fn(async () => {
      throw new Error('userData unavailable');
    }) as never;

    render(<SettingsPanel initialTab="about" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Build info unavailable: userData unavailable/)
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Path info unavailable/)).toBeInTheDocument();
  });
});
