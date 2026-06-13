/**
 * Packaged-app auto-update status (electron-updater).
 */

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface AppUpdateStatus {
  phase: AppUpdatePhase;
  version?: string;
  /** 0–100 when `phase === 'downloading'`. */
  percent?: number;
  transferred?: number;
  total?: number;
  error?: string;
}

export interface AppCheckUpdatesResult {
  updateAvailable: boolean;
  version?: string;
  status: AppUpdateStatus;
}
