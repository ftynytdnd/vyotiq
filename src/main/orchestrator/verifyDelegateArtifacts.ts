/**
 * Synchronous post-delegate filesystem checks for mutation-style tasks.
 */

import { access, readFile, stat } from 'node:fs/promises';
import { escapeXmlAttr, escapeXmlBody } from './envelope/escapeXmlBody.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';

export interface HostVerificationLine {
  path: string;
  ok: boolean;
  detail: string;
}

export interface DelegateArtifactSpec {
  id: string;
  task: string;
  /** Workspace-relative paths resolved at spawn time. */
  files: readonly string[];
}

/** Broader mutation-task heuristic than bare create/edit prefixes. */
const MUTATION_TASK_RE =
  /\b(create|edit|fix|update|implement|add|write|modify|patch|refactor|rename|build)\b|`[^`]+`/i;

function taskNeedsArtifactCheck(task: string): boolean {
  return MUTATION_TASK_RE.test(task.trim());
}

export async function verifyDelegateArtifacts(
  entries: readonly DelegateArtifactSpec[],
  workspacePath: string
): Promise<HostVerificationLine[]> {
  const lines: HostVerificationLine[] = [];
  for (const entry of entries) {
    if (!taskNeedsArtifactCheck(entry.task)) continue;
    for (const rel of entry.files) {
      let abs: string;
      try {
        abs = await realpathInsideWorkspace(workspacePath, rel);
      } catch {
        lines.push({ path: rel, ok: false, detail: 'outside workspace' });
        continue;
      }
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
    .map(
      (l) =>
        `<file path="${escapeXmlAttr(l.path)}" ok="${l.ok ? 'true' : 'false'}">${escapeXmlBody(l.detail)}</file>`
    )
    .join('\n');
  return `<host_verification>\n${inner}\n</host_verification>`;
}
