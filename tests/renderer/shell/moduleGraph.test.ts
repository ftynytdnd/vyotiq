/**
 * Regression: titlebar must not import dockShared (store cycle).
 * A circular import previously blanked the renderer at boot.
 */

import { describe, expect, it } from 'vitest';

describe('shell module graph', () => {
  it('loads titlebar, dock, and ui store without temporal-dead-zone errors', async () => {
    await expect(import('@renderer/components/titlebar/TitleBar')).resolves.toBeDefined();
    await expect(import('@renderer/components/dock/LeftDock')).resolves.toBeDefined();
    await expect(import('@renderer/store/useUiStore')).resolves.toBeDefined();
    const { DOCK_STRIP_WIDTH } = await import('@shared/dock/dockWidth.js');
    expect(DOCK_STRIP_WIDTH).toBe(44);
  });
});
