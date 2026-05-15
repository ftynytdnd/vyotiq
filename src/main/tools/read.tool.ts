/**
 * `read` tool — reads a UTF-8 file inside the workspace, with optional line
 * range. Hard cap on bytes to keep tokens bounded.
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import { realpathInsideWorkspace, workspaceRelative } from './sandbox.js';
import { READ_MAX_BYTES } from '@shared/constants.js';

interface ReadArgs {
  path: string;
  startLine?: number;
  endLine?: number;
}

export const readTool: Tool = {
  name: 'read',
  briefMarkdown: `### Tool: \`read\`

**WHAT it is.** Reads a UTF-8 file from the workspace. Returns content with 1-indexed line numbers prefixed.

**HOW to use it.** Provide a \`path\`. Optionally bound the read with \`startLine\` and \`endLine\`.
\`\`\`json
{ "name": "read", "arguments": { "path": "src/index.ts", "startLine": 1, "endLine": 80 } }
\`\`\`

**WHY it exists.** To inspect the actual contents of a file before editing it. Reading before editing is mandatory.

**WHEN to trigger it.** Before any \`edit\` call. Whenever a question depends on file contents.

**Notes.**
- Files larger than 512 KB are truncated. Binary files are refused.
- **Output format:** each content line is prefixed with \`     N\\t\` where N is the 1-indexed line number. **The \`     N\\t\` prefix is NOT part of the file.** When you pass content to \`edit\`'s \`oldString\`, you MUST strip every \`     N\\t\` prefix first, otherwise the match will fail.`,
  schema: {
    type: 'function',
    function: {
      name: 'read',
      description:
        'Read a UTF-8 text file inside the workspace. Returns line-numbered content. Capped at 512 KB.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to workspace root.' },
          startLine: { type: 'number', description: '1-indexed start line (inclusive).' },
          endLine: { type: 'number', description: '1-indexed end line (inclusive).' }
        },
        required: ['path']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<ReadArgs>;
    if (typeof a.path !== 'string' || !a.path.trim()) {
      return {
        id,
        name: 'read',
        ok: false,
        output: 'Error: `path` is required.',
        error: 'missing path',
        durationMs: Date.now() - started
      };
    }

    let abs: string;
    try {
      // realpath check rejects symlinks resolving outside the workspace
      // even when the lexical path appears safe.
      abs = await realpathInsideWorkspace(ctx.workspacePath, a.path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id,
        name: 'read',
        ok: false,
        output: `Sandbox error: ${msg}`,
        error: msg,
        durationMs: Date.now() - started
      };
    }

    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id,
        name: 'read',
        ok: false,
        output: `Failed to read ${a.path}: ${msg}`,
        error: msg,
        durationMs: Date.now() - started
      };
    }

    let truncated = false;
    if (buf.length > READ_MAX_BYTES) {
      buf = buf.subarray(0, READ_MAX_BYTES);
      truncated = true;
    }

    // Binary detection: any NUL byte in the first 8 KB OR more than 5 %
    // of probe bytes outside the printable + UTF-8 envelope. The previous
    // heuristic was just NUL-in-first-4 KB which let through a number of
    // binary formats (UTF-16, some compressed blobs) whose null bytes
    // start later in the file.
    const probe = buf.subarray(0, Math.min(8192, buf.length));
    let nonText = 0;
    for (let i = 0; i < probe.length; i++) {
      const b = probe[i]!;
      if (b === 0) {
        return binaryRefusal(id, started, a.path);
      }
      // Allow tab(9), LF(10), CR(13), printable ASCII (32–126), and any
      // byte ≥128 (UTF-8 continuation/lead). Everything else is suspect.
      if ((b < 9 || (b > 13 && b < 32)) && b < 128) nonText++;
    }
    if (probe.length > 0 && nonText > probe.length * 0.05) {
      return binaryRefusal(id, started, a.path);
    }

    const text = buf.toString('utf8');
    const lines = text.split('\n');
    const start = Math.max(1, a.startLine ?? 1);
    const end = Math.min(lines.length, a.endLine ?? lines.length);
    const slice = lines.slice(start - 1, end);
    const numbered = slice
      .map((l, i) => `${String(start + i).padStart(5, ' ')}\t${l}`)
      .join('\n');
    const relPath = workspaceRelative(ctx.workspacePath, abs);

    const header =
      `# ${relPath} (lines ${start}-${end} of ${lines.length}${truncated ? ', TRUNCATED' : ''})\n` +
      `# Each line is prefixed with "     N\\t" — strip this prefix before passing content to \`edit\`'s oldString.`;
    return {
      id,
      name: 'read',
      ok: true,
      output: header + '\n' + numbered,
      data: {
        tool: 'read',
        path: relPath,
        fromLine: start,
        toLine: end,
        totalLines: lines.length,
        content: slice.join('\n'),
        truncated
      },
      durationMs: Date.now() - started
    };
  }
};

function binaryRefusal(id: string, started: number, path: string): ToolResult {
  return {
    id,
    name: 'read',
    ok: false,
    output: `Refusing to read binary file: ${path}`,
    error: 'binary file',
    durationMs: Date.now() - started
  };
}
