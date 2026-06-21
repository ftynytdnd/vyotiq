/**
 * userData layout migration — moves legacy root-level files into vyotiq/.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLOBAL_META_FILE,
  SETTINGS_FILE
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

import { migrateUserDataLayout } from '@main/paths/migrateUserDataLayout';
import {
  globalMetaFilePath,
  settingsFilePath,
  vyotiqDataDir
} from '@main/paths/userDataLayout';

afterEach(async () => {
  if (electronRoot.path) {
    await rm(electronRoot.path, { recursive: true, force: true });
    electronRoot.path = '';
  }
});

describe('migrateUserDataLayout', () => {
  it('moves legacy root-level settings and meta-rules into vyotiq/', async () => {
    electronRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-migrate-'));
    const root = electronRoot.path;

    await writeFile(join(root, SETTINGS_FILE), '{"ui":{}}', 'utf8');
    await writeFile(join(root, GLOBAL_META_FILE), '# legacy meta', 'utf8');

    await migrateUserDataLayout();

    expect(await readFile(settingsFilePath(), 'utf8')).toBe('{"ui":{}}');
    expect(await readFile(globalMetaFilePath(), 'utf8')).toBe('# legacy meta');

    await expect(readFile(join(root, SETTINGS_FILE), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, GLOBAL_META_FILE), 'utf8')).rejects.toThrow();
  });

  it('writes DATA_LAYOUT.md on first run', async () => {
    electronRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-migrate-'));
    await migrateUserDataLayout();
    const doc = await readFile(join(vyotiqDataDir(), 'DATA_LAYOUT.md'), 'utf8');
    expect(doc).toContain('Vyotiq local data layout');
    expect(doc).toContain('settings.json');
  });

  it('moves legacy root-level conversations directory into vyotiq/', async () => {
    electronRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-migrate-'));
    const root = electronRoot.path;
    const legacyConv = join(root, 'conversations');
    await mkdir(legacyConv, { recursive: true });
    await writeFile(join(legacyConv, 'orphan.jsonl'), '{"kind":"user-prompt"}\n', 'utf8');

    await migrateUserDataLayout();

    const modernConv = join(vyotiqDataDir(), 'conversations', 'orphan.jsonl');
    expect(await readFile(modernConv, 'utf8')).toContain('user-prompt');
    await expect(readFile(join(legacyConv, 'orphan.jsonl'), 'utf8')).rejects.toThrow();
  });

  it('is idempotent when vyotiq paths already exist', async () => {
    electronRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-migrate-'));
    const root = electronRoot.path;
    await writeFile(join(root, SETTINGS_FILE), '{"legacy":true}', 'utf8');
    await migrateUserDataLayout();
    await writeFile(join(root, SETTINGS_FILE), '{"legacy":true}', 'utf8');
    await migrateUserDataLayout();
    expect(await readFile(settingsFilePath(), 'utf8')).toBe('{"legacy":true}');
    expect(await readFile(join(root, `${SETTINGS_FILE}.pre-layout-migration`), 'utf8')).toBe(
      '{"legacy":true}'
    );
  });
});
