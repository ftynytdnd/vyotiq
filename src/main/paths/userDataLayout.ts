/**
 * Canonical on-disk layout for Vyotiq-owned persistence under Electron
 * `userData`.
 *
 * Electron also stores Chromium caches directly under `userData` (Cache/,
 * GPUCache/, Partitions/, …). All Vyotiq application data lives under
 * `<userData>/vyotiq/` so backups and support can target one folder.
 *
 * ```
 * %APPDATA%/vyotiq/                 ← Electron userData (app product name)
 *   Cache/ …                        ← Electron-managed (do not move)
 *   vyotiq/                         ← Vyotiq-owned namespace
 *     DATA_LAYOUT.md
 *     settings.json
 *     providers.encrypted.json
 *     meta-rules.md
 *     memory-last-referenced.json
 *     scheduled-runs.json
 *     models-dev-catalog.json
 *     conversations/
 *     checkpoints/
 *     logs/
 *     harness-overrides/
 *     attachments/
 * ```
 */

import { app } from 'electron';
import { join } from 'node:path';
import {
  GLOBAL_META_FILE,
  PROVIDERS_FILE,
  SETTINGS_FILE,
  VYOTIQ_DATA_DIR_NAME
} from '@shared/constants.js';

/** Electron `app.getPath('userData')` — includes Chromium profile dirs. */
export function electronUserDataDir(): string {
  return app.getPath('userData');
}

/** All Vyotiq-owned persistence: `<electronUserData>/vyotiq`. */
export function vyotiqDataDir(): string {
  return join(electronUserDataDir(), VYOTIQ_DATA_DIR_NAME);
}

export function vyotiqDataPath(...segments: string[]): string {
  return join(vyotiqDataDir(), ...segments);
}

export function settingsFilePath(): string {
  return vyotiqDataPath(SETTINGS_FILE);
}

export function providersFilePath(): string {
  return vyotiqDataPath(PROVIDERS_FILE);
}

export function globalMetaFilePath(): string {
  return vyotiqDataPath(GLOBAL_META_FILE);
}

export function conversationsDir(): string {
  return vyotiqDataPath('conversations');
}

export function checkpointsDir(): string {
  return vyotiqDataPath('checkpoints');
}

export function logsDir(): string {
  return vyotiqDataPath('logs');
}

export function attachmentsDir(): string {
  return vyotiqDataPath('attachments');
}

export function visionCacheDir(): string {
  return vyotiqDataPath('vision-cache');
}

export function harnessOverridesDir(): string {
  return vyotiqDataPath('harness-overrides');
}

export function scheduledRunsFilePath(): string {
  return vyotiqDataPath('scheduled-runs.json');
}

export function conversationHeartbeatsFilePath(): string {
  return vyotiqDataPath('conversation-heartbeats.json');
}

export function memoryLastReferencedFilePath(): string {
  return vyotiqDataPath('memory-last-referenced.json');
}

export function modelsDevCatalogFilePath(): string {
  return vyotiqDataPath('models-dev-catalog.json');
}

export function nvidiaNgcCatalogFilePath(): string {
  return vyotiqDataPath('nvidia-ngc-context.json');
}
