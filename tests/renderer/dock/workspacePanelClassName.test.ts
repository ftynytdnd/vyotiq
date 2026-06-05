/**
 * Workspace panel height — equal split with chats panel.
 */

import { describe, expect, it } from 'vitest';
import { workspacePanelClassName } from '@renderer/components/dock/dockShared';

describe('workspacePanelClassName', () => {
  it('uses equal flex split for any workspace count', () => {
    expect(workspacePanelClassName(1)).toContain('flex-1');
    expect(workspacePanelClassName(10)).toContain('flex-1');
    expect(workspacePanelClassName(1)).not.toContain('max-h-[38%]');
  });
});
