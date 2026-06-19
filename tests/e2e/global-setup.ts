/**
 * Ensures electron-vite build artifacts exist before Electron launch.
 * Skipped when `VYOTIQ_E2E_SKIP_BUILD=1` (smoketest-no-compile).
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export default async function globalSetup(): Promise<void> {
  if (process.env.VYOTIQ_E2E_SKIP_BUILD === '1') {
    return;
  }

  const repoRoot = process.cwd();
  const mainEntry = path.join(repoRoot, 'out/main/index.js');

  if (existsSync(mainEntry) && process.env.VYOTIQ_E2E_FORCE_BUILD !== '1') {
    return;
  }

  execSync('npm run build', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env
  });
}
