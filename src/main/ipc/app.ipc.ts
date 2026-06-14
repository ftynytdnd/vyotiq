/**
 * App-info IPC. Surfaces the app's identity (version, runtime) and the
 * on-disk paths it's reading from so the renderer's Settings → About tab
 * can show them.
 */

import { app, nativeTheme, shell } from 'electron';
import { spawn } from 'node:child_process';
import { IPC } from '@shared/constants.js';
import type { AppInfo, AppRevealTarget } from '@shared/types/ipc.js';
import type { AppCheckUpdatesResult, AppUpdateStatus } from '@shared/types/appUpdate.js';
import {
  electronUserDataDir,
  logsDir,
  settingsFilePath,
  vyotiqDataDir
} from '../paths/userDataLayout.js';
import {
  checkForAppUpdates,
  downloadAppUpdate,
  installDownloadedUpdate
} from '../updater/autoUpdaterService.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertEnum } from './validate.js';
import { logger } from '../logging/logger.js';

const log = logger.child('app-ipc');

/** Best-effort OS warning sound for destructive confirm UX. */
function playWarningSound(): void {
  try {
    if (process.platform === 'darwin') {
      spawn('afplay', ['/System/Library/Sounds/Funk.aiff'], {
        stdio: 'ignore',
        detached: true
      }).unref();
      return;
    }
    if (process.platform === 'win32') {
      spawn(
        'powershell.exe',
        ['-NoProfile', '-Command', '[System.Media.SystemSounds]::Exclamation.Play()'],
        { stdio: 'ignore', windowsHide: true, detached: true }
      ).unref();
      return;
    }
    spawn('paplay', ['/usr/share/sounds/freedesktop/stereo/dialog-warning.oga'], {
      stdio: 'ignore',
      detached: true
    })
      .on('error', () => {
        spawn('printf', ['\a'], { stdio: 'ignore', detached: true }).unref();
      })
      .unref();
  } catch (err) {
    log.debug('playWarningSound failed', { err });
  }
}

const REVEAL_TARGETS = ['userData', 'settings', 'log'] as const;

function resolvePaths(): {
  electronUserDataDir: string;
  vyotiqDataDir: string;
  settingsFile: string;
  logDir: string;
} {
  return {
    electronUserDataDir: electronUserDataDir(),
    vyotiqDataDir: vyotiqDataDir(),
    settingsFile: settingsFilePath(),
    logDir: logsDir()
  };
}

export function registerAppIpc(): void {
  wrapIpcHandler(IPC.APP_INFO_GET, async (): Promise<AppInfo> => {
    const paths = resolvePaths();
    return {
      version: app.getVersion(),
      electron: process.versions['electron'] ?? '',
      node: process.versions['node'] ?? '',
      userDataDir: paths.vyotiqDataDir,
      electronUserDataDir: paths.electronUserDataDir,
      settingsFile: paths.settingsFile,
      logDir: paths.logDir
    };
  });

  wrapIpcHandler(
    IPC.APP_REVEAL_PATH,
    async (_event, target: AppRevealTarget): Promise<void> => {
      assertEnum('app:revealPath', 'target', target, REVEAL_TARGETS);
      const paths = resolvePaths();
      let absolute: string;
      switch (target) {
        case 'userData':
          absolute = paths.vyotiqDataDir;
          break;
        case 'settings':
          absolute = paths.settingsFile;
          break;
        case 'log':
          absolute = paths.logDir;
          break;
        default: {
          const _exhaustive: never = target;
          void _exhaustive;
          throw new Error(`Unknown reveal target: ${String(target)}`);
        }
      }
      shell.showItemInFolder(absolute);
    }
  );

  wrapIpcHandler(
    IPC.APP_SET_THEME_SOURCE,
    async (_event, mode: 'dark' | 'light' | 'system'): Promise<void> => {
      assertEnum('app:setThemeSource', 'mode', mode, ['dark', 'light', 'system'] as const);
      nativeTheme.themeSource = mode;
    }
  );

  wrapIpcHandler(IPC.APP_PLAY_WARNING_SOUND, async (): Promise<void> => {
    playWarningSound();
  });

  wrapIpcHandler(IPC.APP_CHECK_UPDATES, async (): Promise<AppCheckUpdatesResult> => {
    try {
      return await checkForAppUpdates();
    } catch (err) {
      log.warn('checkForUpdates failed', { err });
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

  wrapIpcHandler(IPC.APP_DOWNLOAD_UPDATE, async (): Promise<AppUpdateStatus> => {
    try {
      return await downloadAppUpdate();
    } catch (err) {
      log.warn('downloadUpdate failed', { err });
      throw err instanceof Error ? err : new Error(String(err));
    }
  });

  wrapIpcHandler(IPC.APP_INSTALL_UPDATE, async (): Promise<void> => {
    installDownloadedUpdate();
  });
}
