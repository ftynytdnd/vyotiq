/**
 * Workspace switcher rail height — compact strip above the active panel.
 */

import { describe, expect, it } from 'vitest';
import { workspacePanelClassName } from '@renderer/components/dock/dockShared';

describe('workspacePanelClassName', () => {
  it('caps workspace switcher height so the active panel can flex', () => {
    expect(workspacePanelClassName(1)).toContain('shrink-0');
    expect(workspacePanelClassName(10)).toContain('max-h-[9.5rem]');
    expect(workspacePanelClassName(1)).not.toContain('flex-1');
  });
});
