/**
 * Sandbox path guards for workspace file CRUD IPC.
 */

import { WORKSPACE_DOTDIR } from '@shared/constants.js';

export function assertSafeRelativePath(
  label: string,
  field: string,
  relPath: string,
  opts?: { allowDotRoot?: boolean; allowDotVyotiq?: boolean }
): void {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm || norm === '..') {
    throw new Error(`${label}: invalid ${field}.`);
  }
  if (norm === '.' && !opts?.allowDotRoot) {
    throw new Error(`${label}: invalid ${field}.`);
  }
  const parts = norm.split('/');
  if (parts.some((p) => p === '..' || p === '')) {
    throw new Error(`${label}: path must stay inside the workspace.`);
  }
  if (
    !opts?.allowDotVyotiq &&
    (parts[0] === WORKSPACE_DOTDIR || norm.startsWith(`${WORKSPACE_DOTDIR}/`))
  ) {
    throw new Error(`${label}: cannot modify ${WORKSPACE_DOTDIR} metadata.`);
  }
}
