/**
 * One-time migration: move legacy root-level Vyotiq files into
 * `<userData>/vyotiq/` and normalize cache filenames.
 */

import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GLOBAL_META_FILE,
  PROVIDERS_FILE,
  SETTINGS_FILE
} from '@shared/constants.js';
import { logger } from '../logging/logger.js';
import {
  electronUserDataDir,
  memoryLastReferencedFilePath,
  modelsDevCatalogFilePath,
  nvidiaNgcCatalogFilePath,
  vyotiqDataDir,
  vyotiqDataPath
} from './userDataLayout.js';

const log = logger.child('paths/migrate');

const LAYOUT_DOC = `# Vyotiq local data layout

This folder holds all Vyotiq-owned persistence for this install.
Electron/Chromium caches (Cache/, GPUCache/, Partitions/, …) live one
level up in the Electron \`userData\` directory and are managed by
Electron — do not move them.

## Structure

| Path | Purpose |
|------|---------|
| \`settings.json\` | App + workspace registry (plain JSON) |
| \`providers.encrypted.json\` | Provider API keys (OS-encrypted) |
| \`meta-rules.md\` | Global Agent V meta-rules |
| \`memory-last-referenced.json\` | Memory panel "last referenced" hints |
| \`scheduled-runs.json\` | Local scheduled agent prompts |
| \`models-dev-catalog.json\` | Cached models.dev metadata |
| \`conversation-heartbeats.json\` | Per-conversation async wake polling |
| \`vision-cache/\` | Prepared vision attachment cache |
| \`conversations/\` | Chat JSONL transcripts + index |
| \`checkpoints/\` | Run rewind blob store |
| \`logs/\` | Rolling \`vyotiq.log\` |
| \`harness-overrides/\` | User-edited harness markdown |
| \`attachments/\` | Ingested chat attachments |

Workspace-scoped agent artifacts (memory notes, vector index, reports,
compaction) live under each workspace's \`.vyotiq/\` folder.
`;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function migrateEntry(legacyPath: string, modernPath: string): Promise<void> {
  if (!(await pathExists(legacyPath))) return;
  if (legacyPath === modernPath) return;

  await mkdir(vyotiqDataDir(), { recursive: true });

  if (await pathExists(modernPath)) {
    const quarantine = `${legacyPath}.pre-layout-migration`;
    if (!(await pathExists(quarantine))) {
      await rename(legacyPath, quarantine);
      log.info('quarantined legacy userData entry (modern path already exists)', {
        legacyPath,
        modernPath,
        quarantine
      });
    }
    return;
  }

  await rename(legacyPath, modernPath);
  log.info('migrated userData layout entry', { from: legacyPath, to: modernPath });
}

async function migrateFilePair(legacyName: string, modernName: string): Promise<void> {
  const root = electronUserDataDir();
  await migrateEntry(join(root, legacyName), vyotiqDataPath(modernName));
  await migrateEntry(join(root, `${legacyName}.tmp`), vyotiqDataPath(`${modernName}.tmp`));
}

/**
 * Run before any settings / secrets / memory reads on boot.
 * Idempotent — safe to call every launch.
 */
export async function migrateUserDataLayout(): Promise<void> {
  await mkdir(vyotiqDataDir(), { recursive: true });

  const root = electronUserDataDir();

  await migrateFilePair(SETTINGS_FILE, SETTINGS_FILE);
  await migrateFilePair(PROVIDERS_FILE, PROVIDERS_FILE);
  await migrateFilePair(GLOBAL_META_FILE, GLOBAL_META_FILE);

  await migrateEntry(join(root, 'attachments'), vyotiqDataPath('attachments'));

  await migrateEntry(join(root, 'conversations'), vyotiqDataPath('conversations'));
  await migrateEntry(join(root, 'checkpoints'), vyotiqDataPath('checkpoints'));
  await migrateEntry(join(root, 'logs'), vyotiqDataPath('logs'));
  await migrateEntry(join(root, 'harness-overrides'), vyotiqDataPath('harness-overrides'));
  await migrateEntry(join(root, 'vision-cache'), vyotiqDataPath('vision-cache'));
  await migrateEntry(join(root, 'vyotiq', 'conversations'), vyotiqDataPath('conversations'));
  await migrateEntry(join(root, 'vyotiq', 'checkpoints'), vyotiqDataPath('checkpoints'));
  await migrateEntry(join(root, 'vyotiq', 'logs'), vyotiqDataPath('logs'));
  await migrateEntry(join(root, 'vyotiq', 'harness-overrides'), vyotiqDataPath('harness-overrides'));
  await migrateEntry(join(root, 'vyotiq', 'vision-cache'), vyotiqDataPath('vision-cache'));
  await migrateFilePair('conversation-heartbeats.json', 'conversation-heartbeats.json');
  await migrateEntry(
    join(root, 'vyotiq', 'conversation-heartbeats.json'),
    vyotiqDataPath('conversation-heartbeats.json')
  );

  // Legacy double-prefix cache paths (safeStore used to join userData + `vyotiq/...`).
  await migrateEntry(
    join(root, 'vyotiq', 'models-dev-catalog.json'),
    modelsDevCatalogFilePath()
  );
  await migrateEntry(
    join(root, 'vyotiq', 'nvidia-ngc-context.json'),
    nvidiaNgcCatalogFilePath()
  );
  await migrateEntry(
    join(root, 'vyotiq', 'memory-last-referenced.json'),
    memoryLastReferencedFilePath()
  );
  await migrateEntry(
    join(root, 'vyotiq', 'scheduled-runs.json'),
    vyotiqDataPath('scheduled-runs.json')
  );

  const layoutDoc = vyotiqDataPath('DATA_LAYOUT.md');
  if (!(await pathExists(layoutDoc))) {
    await writeFile(layoutDoc, LAYOUT_DOC, 'utf8');
  }
}
