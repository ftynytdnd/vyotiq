import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  AGENT_BEHAVIOR_SECTION_LABELS,
  type AgentBehaviorSectionId
} from '@shared/settings/agentBehaviorSection.js';

/** Open full-screen settings via the default `Mod+,` binding. */
export async function openSettings(window: Page): Promise<void> {
  await window.keyboard.press('Control+Comma');
  await expect(window.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(window.getByRole('tablist', { name: 'Settings sections' })).toBeVisible();
}

/** Navigate Settings → Agent behavior → a subsection tab. */
export async function openAgentBehaviorSection(
  window: Page,
  section: AgentBehaviorSectionId = 'skills'
): Promise<void> {
  const settingsNav = window.getByRole('tablist', { name: 'Settings sections' });
  await settingsNav.getByRole('tab', { name: 'Agent behavior' }).click();
  const label = AGENT_BEHAVIOR_SECTION_LABELS[section];
  await window
    .getByRole('tablist', { name: 'Agent behavior sections' })
    .getByRole('tab', { name: label })
    .click();
  await expect(window.locator('.vx-settings-subpanel-title')).toHaveText(label);
}

/** Navigate Settings → Workspace data. */
export async function openWorkspaceDataSection(window: Page): Promise<void> {
  const settingsNav = window.getByRole('tablist', { name: 'Settings sections' });
  await settingsNav.getByRole('tab', { name: 'Workspace data' }).click();
  await expect(window.locator('.vx-settings-panel-title')).toHaveText('Workspace data');
}

/** Leave settings via the dock back control (settings mode). */
export async function closeSettings(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Back to chat' }).click();
  await expect(window.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
}

/** Active conversation id from persisted workspace session settings. */
export async function getActiveConversationId(window: Page): Promise<string> {
  return window.evaluate(async () => {
    const state = await window.vyotiq.workspace.list();
    if (!state.activeId) throw new Error('no active workspace');
    const settings = await window.vyotiq.settings.get();
    const convId = settings.ui?.activeConversationByWorkspace?.[state.activeId];
    if (!convId) throw new Error('no active conversation');
    return convId;
  });
}
