/**
 * Workspace panel height cap for short workspace lists.
 */

import { describe, expect, it } from 'vitest';
import { workspacePanelClassName, DOCK_WORKSPACE_PANEL_CAP } from '@renderer/components/dock/dockShared';

describe('workspacePanelClassName', () => {
  it('uses content height for short lists', () => {
    expect(workspacePanelClassName(DOCK_WORKSPACE_PANEL_CAP)).not.toContain('max-h');
  });

  it('caps height when many workspaces are registered', () => {
    expect(workspacePanelClassName(DOCK_WORKSPACE_PANEL_CAP + 1)).toContain('max-h-[38%]');
  });
});
