/**
 * Synchronous post-delegate filesystem checks for create/edit-style tasks.
 */

import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParsedDelegate } from './envelope/index.js';

export interface HostVerificationLine {
  path: string;
  ok: boolean;
  detail: string;
}

export async function verifyDelegateArtifacts(
  delegates: ParsedDelegate[],
  workspacePath: string
): Promise<HostVerificationLine[]> {
  const lines: HostVerificationLine[] = [];
  for (const d of delegates) {
    const task = d.task.trim().toLowerCase();
    const isCreateEdit =
      task.startsWith('create ') ||
      task.startsWith('edit ') ||
      task.includes('create `') ||
      task.includes('edit `');
    if (!isCreateEdit) continue;
    for (const rel of d.files) {
      const abs = join(workspacePath, rel);
      try {
        await access(abs);
        const st = await stat(abs);
        if (!st.isFile()) {
          lines.push({ path: rel, ok: false, detail: 'not a file' });
          continue;
        }
        if (st.size === 0) {
          lines.push({ path: rel, ok: false, detail: 'empty file' });
          continue;
        }
        const head = await readFile(abs, { encoding: 'utf8' });
        if (head.trim().length === 0) {
          lines.push({ path: rel, ok: false, detail: 'whitespace-only' });
        } else {
          lines.push({ path: rel, ok: true, detail: `${st.size} bytes` });
        }
      } catch {
        lines.push({ path: rel, ok: false, detail: 'missing' });
      }
    }
  }
  return lines;
}

export function formatHostVerificationXml(lines: HostVerificationLine[]): string {
  if (lines.length === 0) return '';
  const inner = lines
    .map((l) => `<file path="${l.path}" ok="${l.ok ? 'true' : 'false'}">${l.detail}</file>`)
    .join('\n');
  return `<host_verification>\n${inner}\n</host_verification>`;
}
