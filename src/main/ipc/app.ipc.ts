/**
 * App-info IPC. Surfaces the app's identity (version, runtime) and the
 * on-disk paths it's reading from (userData, settings.json, log dir) so
 * the renderer's Settings → About tab can show them.
 *
 * Two channels:
 *   - `APP_INFO_GET`     returns a small `AppInfo` JSON snapshot.
 *   - `APP_REVEAL_PATH`  opens one of the three paths in the OS file
 *                       manager. The renderer passes an enum (`'userData'`
 *                       | `'settings'` | `'log'`) — never a raw path —
 *                       so the channel can't be abused to open
 *                       arbitrary filesystem locations.
 *
 * The path mapping (`userData → app.getPath('userData')`, etc.) is the
 * single source of truth shared by both handlers so the two channels
 * cannot drift.
 */

import { app, nativeTheme, shell } from 'electron';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { IPC, SETTINGS_FILE } from '@shared/constants.js';
import type { AppInfo, AppRevealTarget } from '@shared/types/ipc.js';
import type { AppCheckUpdatesResult, AppUpdateStatus } from '@shared/types/appUpdate.js';
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

/**
 * Resolves the same three paths the About tab surfaces. Kept inside a
 * single function so `APP_INFO_GET` and `APP_REVEAL_PATH` cannot
 * diverge — a future move of the log dir or settings file lands here
 * once and both channels follow.
 *
 * Mirrors the layout used by:
 *   - `src/main/logging/logger.ts` (`<userData>/vyotiq/logs/`)
 *   - `src/main/secrets/safeStore.ts` (settings + encrypted blobs live
 *     directly under `<userData>/`).
 */
function resolvePaths(): { userDataDir: string; settingsFile: string; logDir: string } {
  const userDataDir = app.getPath('userData');
  return {
    userDataDir,
    settingsFile: join(userDataDir, SETTINGS_FILE),
    logDir: join(userDataDir, 'vyotiq', 'logs')
  };
}

export function registerAppIpc(): void {
  wrapIpcHandler(IPC.APP_INFO_GET, async (): Promise<AppInfo> => {
    const { userDataDir, settingsFile, logDir } = resolvePaths();
    return {
      version: app.getVersion(),
      electron: process.versions['electron'] ?? '',
      node: process.versions['node'] ?? '',
      userDataDir,
      settingsFile,
      logDir
    };
  });

  wrapIpcHandler(
    IPC.APP_REVEAL_PATH,
    async (_event, target: AppRevealTarget): Promise<void> => {
      assertEnum('app:revealPath', 'target', target, REVEAL_TARGETS);
      const { userDataDir, settingsFile, logDir } = resolvePaths();
      // Enum mapping — anything else (typo, malicious payload) rejects
      // with a structured error rather than silently revealing whatever
      // happened to be the closest match.
      let absolute: string;
      switch (target) {
        case 'userData':
          absolute = userDataDir;
          break;
        case 'settings':
          absolute = settingsFile;
          break;
        case 'log':
          absolute = logDir;
          break;
        default: {
          // Exhaustive guard. If a new `AppRevealTarget` variant is
          // added to the shared union without updating this switch,
          // TypeScript flags the assignment below at compile time.
          const _exhaustive: never = target;
          void _exhaustive;
          throw new Error(`Unknown reveal target: ${String(target)}`);
        }
      }
      // `shell.showItemInFolder` opens the parent dir and selects the
      // entry when the path points at a file; for a directory target it
      // opens the dir itself. Both behaviors are what the user wants
      // here — a file gets selected, a folder gets opened.
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
