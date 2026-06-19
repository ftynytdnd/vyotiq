import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getRepoRoot(): string {
  return process.cwd();
}

export function getMainEntryPath(): string {
  const mainEntry = path.join(getRepoRoot(), 'out/main/index.js');
  if (!existsSync(mainEntry)) {
    throw new Error(
      `Missing ${mainEntry}. Run npm run build or npm run smoketest (builds automatically).`
    );
  }
  return mainEntry;
}

export async function createE2EUserDataDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-'));
}

export async function removeE2EUserDataDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
