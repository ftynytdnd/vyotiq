/**
 * Best-effort file restore when checkpoint blobs are missing (legacy transcripts).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function isGitRepo(workspacePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: workspacePath,
      timeout: 5_000,
      windowsHide: true
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Restore a workspace-relative file from the last committed git state.
 * Returns false when git is unavailable or the checkout fails.
 */
export async function tryGitRestoreFile(
  workspacePath: string,
  filePath: string
): Promise<boolean> {
  try {
    if (!(await isGitRepo(workspacePath))) return false;
    await execFileAsync('git', ['checkout', 'HEAD', '--', filePath], {
      cwd: workspacePath,
      timeout: 30_000,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}
