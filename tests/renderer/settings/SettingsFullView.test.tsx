/**
 * SettingsFullView — stacked header and in-pane navigation shell.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsFullView } from '@renderer/components/settings/SettingsFullView';
import { useAppViewStore } from '@renderer/store/useAppViewStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    settings: { set: vi.fn(async () => {}) },
    memory: { list: vi.fn(async () => []), get: vi.fn(async () => ({ content: '', key: 'x' })) }
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
  it('uses a stacked header with the page title', () => {
    render(<SettingsFullView initialSection="appearance" />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to chat' })).toBeNull();
    expect(document.querySelector('.vx-settings-inpane')).not.toBeNull();
  });

  it('renders section nav inside the in-pane layout', () => {
    render(<SettingsFullView initialSection="appearance" />);
    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Appearance/i })).toHaveAttribute('aria-selected', 'true');
  });
});
