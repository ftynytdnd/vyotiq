/**
 * SettingsFullView — in-pane navigation shell with title in nav column.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsFullView } from '@renderer/components/settings/SettingsFullView';
import { useAppViewStore } from '@renderer/store/useAppViewStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    settings: { set: vi.fn(async () => {}) },
    memory: { list: vi.fn(async () => []), get: vi.fn(async () => ({ content: '', key: 'x' })) },
    app: { info: vi.fn(async () => ({ version: '0.1.0', name: 'Vyotiq' })) }
  }
}));

beforeEach(() => {
  useAppViewStore.setState({
    view: 'settings',
    settingsSection: 'appearance',
    aboutOpen: false
  });
  useSettingsStore.setState({
    loading: false,
    settings: { ui: { theme: 'dark', density: 'balanced' } }
  } as never);
});

describe('SettingsFullView shell', () => {
  it('places the page title in the nav column without a duplicate header back link', () => {
    render(<SettingsFullView initialSection="appearance" />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to chat' })).toBeNull();
    expect(document.querySelector('.vx-settings-shell')).not.toBeNull();
  });

  it('renders section nav including About with correct selection', () => {
    render(<SettingsFullView initialSection="appearance" />);
    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Appearance/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /About/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('selects About in the nav when about is open', () => {
    useAppViewStore.setState({ aboutOpen: true, settingsSection: 'about' });
    render(<SettingsFullView initialSection="about" />);
    expect(screen.getByRole('tab', { name: /About/i })).toHaveAttribute('aria-selected', 'true');
  });
});
