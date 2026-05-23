import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: vi.fn(() => false)
}));

vi.mock('@main/window/getMainWindow', () => ({
  getMainWindow: vi.fn(() => ({
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn() }
  }))
}));

import { requestConfirm } from '@main/orchestrator/confirmBus';

describe('confirmBus / send-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves no-ui when the confirm IPC cannot be delivered', async () => {
    await expect(requestConfirm('test')).resolves.toEqual({
      approved: false,
      acceptAllRemaining: false,
      reason: 'no-ui'
    });
  });
});
