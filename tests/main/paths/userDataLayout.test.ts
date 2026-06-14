/**
 * userDataLayout — all Vyotiq paths resolve under the vyotiq/ namespace.
 */

import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLOBAL_META_FILE,
  PROVIDERS_FILE,
  SETTINGS_FILE,
  VYOTIQ_DATA_DIR_NAME
} from '@shared/constants';

const electronRoot = { path: '' };

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return electronRoot.path;
      return electronRoot.path;
    }
  }
}));

import {
  attachmentsDir,
  checkpointsDir,
  conversationsDir,
  electronUserDataDir,
  globalMetaFilePath,
  logsDir,
  providersFilePath,
  settingsFilePath,
  vyotiqDataDir
} from '@main/paths/userDataLayout';

afterEach(() => {
  electronRoot.path = '';
});

describe('userDataLayout', () => {
  it('places all Vyotiq-owned paths under electronUserData/vyotiq', () => {
    electronRoot.path = 'C:\\Users\\test\\AppData\\Roaming\\vyotiq';
    const root = electronUserDataDir();
    const data = vyotiqDataDir();

    expect(data).toBe(join(root, VYOTIQ_DATA_DIR_NAME));
    expect(settingsFilePath()).toBe(join(data, SETTINGS_FILE));
    expect(providersFilePath()).toBe(join(data, PROVIDERS_FILE));
    expect(globalMetaFilePath()).toBe(join(data, GLOBAL_META_FILE));
    expect(conversationsDir()).toBe(join(data, 'conversations'));
    expect(checkpointsDir()).toBe(join(data, 'checkpoints'));
    expect(logsDir()).toBe(join(data, 'logs'));
    expect(attachmentsDir()).toBe(join(data, 'attachments'));
  });
});
