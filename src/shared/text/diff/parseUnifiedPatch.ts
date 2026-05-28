/**
 * Parse a unified-diff patch (e.g. `git diff`) into `DiffHunk[]` for
 * `DiffViewer`. Skips file headers and `\\ No newline` markers.
 */

import type { DiffHunk, DiffLine } from '../../types/tool.js';

const HUNK_HEADER =
  /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedPatch(patch: string): DiffHunk[] {
  const lines = patch.split(/\r?\n/);
  const hunks: DiffHunk[] = [];
  let i = 0;

  while (i < lines.length) {
    const header = HUNK_HEADER.exec(lines[i] ?? '');
    if (!header) {
      i += 1;
      continue;
    }

    const oldStart = Number.parseInt(header[1]!, 10);
    const newStart = Number.parseInt(header[2]!, 10);
    i += 1;

    const body: DiffLine[] = [];
    while (i < lines.length) {
      const line = lines[i]!;
      if (HUNK_HEADER.test(line)) break;
      if (
        line.startsWith('diff --git ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('index ')
      ) {
        break;
      }
      if (line.startsWith('\\')) {
        i += 1;
        continue;
      }
      if (line.length === 0) {
        i += 1;
        break;
      }
      const kind = line[0];
      if (kind === '+' || kind === '-' || kind === ' ') {
        body.push({ kind, text: line.slice(1) });
        i += 1;
        continue;
      }
      break;
    }

    if (body.length > 0) {
      hunks.push({ oldStart, newStart, lines: body });
    }
  }

  return hunks;
}
