/**
 * Resolve the bundled @ast-grep/cli native binary path.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

interface CliPostinstall {
  resolveBinaryPath: () => string | null;
  resolveBinaryDir: () => string | null;
}

function loadPostinstall(): CliPostinstall | null {
  try {
    const pkgJson = require.resolve('@ast-grep/cli/package.json');
    const cliDir = path.dirname(pkgJson);
    return require(path.join(cliDir, 'postinstall.js')) as CliPostinstall;
  } catch {
    return null;
  }
}

export function resolveAstGrepBinaryPath(): string | null {
  const postinstall = loadPostinstall();
  return postinstall?.resolveBinaryPath() ?? null;
}

export function resolveAstGrepBinaryDir(): string | null {
  const postinstall = loadPostinstall();
  const dir = postinstall?.resolveBinaryDir();
  if (dir) return dir;
  const binary = resolveAstGrepBinaryPath();
  return binary ? path.dirname(binary) : null;
}
