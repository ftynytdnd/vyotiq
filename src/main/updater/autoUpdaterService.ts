/**
 * electron-updater wiring — check, auto-download, quit-and-install.
 * Active only in packaged builds (`app.isPackaged`).
 */

import { app } from 'electron';
import type {
  AppCheckUpdatesResult,
  AppUpdatePhase,
  AppUpdateStatus
} from '@shared/types/appUpdate.js';
import { IPC } from '@shared/constants.js';
import { logger } from '../logging/logger.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';

const log = logger.child('updater');

type AutoUpdater = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  verifyUpdateCodeSignature?: boolean;
  setFeedURL?: (config: { provider: 'generic'; url: string }) => void;
  checkForUpdates: () => Promise<{ updateInfo?: { version?: string } } | null>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeAllListeners: (event?: string) => void;
};

let updater: AutoUpdater | null = null;
let initialized = false;

let status: AppUpdateStatus = { phase: 'idle' };

function setStatus(patch: Partial<AppUpdateStatus> & { phase: AppUpdatePhase }): void {
  status = { ...status, ...patch };
  safeWebContentsSend(IPC.APP_UPDATE_STATUS, status);
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return status;
}

async function loadUpdater(): Promise<AutoUpdater | null> {
  if (!app.isPackaged) return null;
  if (updater) return updater;
  try {
    const mod = (await import('electron-updater')) as { autoUpdater: AutoUpdater };
    updater = mod.autoUpdater;
    return updater;
  } catch (err) {
    log.warn('electron-updater unavailable', { err });
    return null;
  }
}

export async function initAutoUpdaterService(): Promise<void> {
  if (initialized || !app.isPackaged) return;
  initialized = true;

  const au = await loadUpdater();
  if (!au) return;

  au.autoDownload = true;
  au.autoInstallOnAppQuit = false;
  au.allowDowngrade = false;

  const feedUrl = process.env.UPDATE_BASE_URL?.trim();
  if (feedUrl && au.setFeedURL) {
    au.setFeedURL({ provider: 'generic', url: feedUrl.replace(/\/$/, '') });
    log.info('autoUpdater feed configured', { feedUrl });
  } else if (!feedUrl) {
    log.info('autoUpdater: UPDATE_BASE_URL unset — update checks require a hosted feed');
  }

  if (process.env.VYOTIQ_ALLOW_UNSIGNED_UPDATES === '1') {
    au.verifyUpdateCodeSignature = false;
    log.warn('autoUpdater: unsigned update installs allowed (dev only)');
  }

  au.on('checking-for-update', () => {
    setStatus({ phase: 'checking', error: undefined });
  });
  au.on('update-available', (info: unknown) => {
    const version =
      typeof info === 'object' && info !== null && 'version' in info
        ? String((info as { version?: string }).version ?? '')
        : undefined;
    setStatus({ phase: 'available', version: version || status.version, error: undefined });
  });
  au.on('update-not-available', () => {
    setStatus({ phase: 'not-available', error: undefined });
  });
  au.on('progress', (progress: unknown) => {
    const p =
      typeof progress === 'object' && progress !== null
        ? (progress as { percent?: number; transferred?: number; total?: number })
        : {};
    setStatus({
      phase: 'downloading',
      percent: typeof p.percent === 'number' ? Math.round(p.percent) : status.percent,
      transferred: typeof p.transferred === 'number' ? p.transferred : status.transferred,
      total: typeof p.total === 'number' ? p.total : status.total
    });
  });
  au.on('update-downloaded', (info: unknown) => {
    const version =
      typeof info === 'object' && info !== null && 'version' in info
        ? String((info as { version?: string }).version ?? '')
        : status.version;
    setStatus({ phase: 'downloaded', version, percent: 100, error: undefined });
  });
  au.on('error', (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('autoUpdater error', { msg });
    setStatus({ phase: 'error', error: msg });
  });

  log.info('autoUpdater initialized (autoDownload=true)');
}

export async function checkForAppUpdates(): Promise<AppCheckUpdatesResult> {
  if (!app.isPackaged) {
    return { updateAvailable: false, status: { phase: 'idle' } };
  }

  const au = await loadUpdater();
  if (!au) {
    const unavailable: AppUpdateStatus = {
      phase: 'error',
      error: 'Updater unavailable in this build'
    };
    return { updateAvailable: false, status: unavailable };
  }

  try {
    const result = await au.checkForUpdates();
    const ver = result?.updateInfo?.version;
    const phase = status.phase === 'idle' ? 'not-available' : status.phase;
    if (ver) {
      setStatus({ phase: 'available', version: ver });
      return { updateAvailable: true, version: ver, status: getAppUpdateStatus() };
    }
    if (status.phase === 'checking') {
      setStatus({ phase: 'not-available' });
    }
    return {
      updateAvailable: phase === 'available' || phase === 'downloading' || phase === 'downloaded',
      version: status.version ?? ver,
      status: getAppUpdateStatus()
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus({ phase: 'error', error: msg });
    throw err;
  }
}

export function installDownloadedUpdate(): void {
  const au = updater;
  if (!au) throw new Error('Updater unavailable');
  if (status.phase !== 'downloaded') {
    throw new Error('No downloaded update ready to install');
  }
  au.quitAndInstall(false, true);
}

export function teardownAutoUpdaterService(): void {
  updater?.removeAllListeners();
  updater = null;
  initialized = false;
  status = { phase: 'idle' };
}
