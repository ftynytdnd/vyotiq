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

import { app, shell } from 'electron';
import { join } from 'node:path';
import { IPC, SETTINGS_FILE } from '@shared/constants.js';
import type { AppInfo, AppRevealTarget } from '@shared/types/ipc.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

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
}
