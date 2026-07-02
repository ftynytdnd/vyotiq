import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test';
import electronPath from 'electron';
import {
  createE2EUserDataDir,
  getMainEntryPath,
  getRepoRoot,
  removeE2EUserDataDir
} from '../helpers/paths.js';
import { stubNativeDialogs } from '../helpers/stubDialogs.js';

type ElectronFixtures = {
  userDataDir: string;
  electronApp: ElectronApplication;
  window: Page;
};

export const test = base.extend<ElectronFixtures>({
  userDataDir: async ({}, use) => {
    const dir = await createE2EUserDataDir();
    await use(dir);
    await removeE2EUserDataDir(dir);
  },

  electronApp: async ({ userDataDir }, use) => {
    const electronApp = await electron.launch({
      executablePath: electronPath,
      args: [getMainEntryPath(), `--user-data-dir=${userDataDir}`],
      cwd: getRepoRoot(),
      timeout: 60_000,
      env: {
        ...process.env,
        ELECTRON_USER_DATA: userDataDir,
        VYOTIQ_LOG_LEVEL: 'warn',
        VYOTIQ_DISABLE_BUNDLED_GITHUB_OAUTH: '1',
        NODE_ENV: 'test'
      }
    });

    await stubNativeDialogs(electronApp);
    await use(electronApp);
    await electronApp.close();
  },

  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  }
});

export { expect } from '@playwright/test';
