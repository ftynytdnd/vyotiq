/**
 * About overlay — verifies AppInfo rendering and Reveal targets.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AboutOverlay } from '@renderer/components/settings/AboutOverlay.js';
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
  window.vyotiq.app.info = vi.fn(async () => fixture) as never;
}

describe('AboutOverlay', () => {
  it('renders version, electron, and node lines from app.info()', async () => {
    stubAppInfo();
    render(<AboutOverlay open onClose={() => {}} />);

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

    render(<AboutOverlay open onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(fixture.userDataDir)).toBeInTheDocument();
    });
    expect(screen.getByText(fixture.settingsFile)).toBeInTheDocument();
    expect(screen.getByText(fixture.logDir)).toBeInTheDocument();

    const user = userEvent.setup();
    const reveals = screen.getAllByRole('button', { name: /Reveal/i });
    expect(reveals).toHaveLength(3);
    await user.click(reveals[0]!);
    expect(revealSpy).toHaveBeenCalledWith('userData');
  });

  it('shows a fallback message when app.info() rejects', async () => {
    window.vyotiq.app.info = vi.fn(async () => {
      throw new Error('userData unavailable');
    }) as never;

    render(<AboutOverlay open onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Build info unavailable: userData unavailable/)).toBeInTheDocument();
    });
  });
});
