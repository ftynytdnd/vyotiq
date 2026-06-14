/**
 * `read` tool — reads a UTF-8 file inside the workspace, with optional line
 * range. Hard cap on bytes to keep tokens bounded.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
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

async function formatReadEnoent(
  workspacePath: string,
  relPath: string,
  msg: string
): Promise<string> {
  const normalized = relPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) {
    return `Failed to read ${relPath}: ${msg}`;
  }
  const parent = parts.slice(0, -1).join('/');
  try {
    await fs.access(join(workspacePath, parent));
    return `Failed to read ${relPath}: ${msg}`;
  } catch {
    const top = parts[0]!;
    const rootEntries = await fs.readdir(workspacePath).catch(() => [] as string[]);
    const tl = top.toLowerCase();
    const near = rootEntries
      .filter((e) => {
        const el = e.toLowerCase();
        return el.includes(tl) || tl.includes(el) || el.slice(0, 4) === tl.slice(0, 4);
      })
      .slice(0, 5);
    if (near.length === 0) {
      return `Failed to read ${relPath}: ${msg}`;
    }
    return (
      `Failed to read ${relPath}: ${msg}\n` +
      `Parent \`${parent}\` not found. Similar at workspace root: ${near.join(', ')}`
    );
  }
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
- **Output format (navigation only):** each content line is \`     N\\t<file bytes>\` where N is 1-indexed (five-digit column, then tab). Regex per line: \`^\\s*\\d+\\t\`. **Prefixes are NOT on disk.** Copy only the bytes after the tab into \`edit\`; the host may auto-strip when every line in \`oldString\`/\`newString\` matches that pattern.`,
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
      const output = await formatReadEnoent(ctx.workspacePath, a.path, msg);
      return {
        id,
        name: 'read',
        ok: false,
        output,
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
    //
    // BOM-aware exemption: a file that opens with a UTF-16 / UTF-32 byte
    // order mark has NUL bytes as a NORMAL part of its text encoding —
    // every ASCII character is paired with a `\0`. Refusing those as
    // "binary" would block any source file PowerShell saved with
    // `Out-File` (the default encoding on older PS) or any file an editor
    // stamped with a UTF-16 BOM. We detect the BOM, decode using the
    // matching encoding, and re-run the heuristic against the decoded
    // text so genuinely-binary content (no BOM, NULs in the stream) is
    // still refused. Audit fix — see review §5.
    const bomEnc = detectBomEncoding(buf);
    if (bomEnc !== null) {
      const text = bomDecode(buf, bomEnc);
      // Re-probe the DECODED text. Genuine text in any BOM-tagged
      // encoding has no remaining NULs; binary masquerading as a
      // BOM'd file would. We use the same 8 KB / 5 % rule as the
      // raw-buffer path.
      const decodedProbe = text.slice(0, 8192);
      let decodedNonText = 0;
      for (let i = 0; i < decodedProbe.length; i++) {
        const code = decodedProbe.charCodeAt(i);
        if (code === 0) {
          return binaryRefusal(id, started, a.path, `NUL after ${bomEnc} BOM at char ${i}`);
        }
        if ((code < 9 || (code > 13 && code < 32)) && code < 128) decodedNonText++;
      }
      if (decodedProbe.length > 0 && decodedNonText > decodedProbe.length * 0.05) {
        return binaryRefusal(id, started, a.path, `${bomEnc} but >5% control bytes`);
      }
      // Re-route through the line-slicing return below by replacing
      // the `buf.toString('utf8')` decode with the BOM-aware result.
      // We do this by assigning a normalised UTF-8 buffer back — the
      // canonical downstream path stays text-based.
      buf = Buffer.from(text, 'utf8');
    } else {
      const noBomEnc = detectUtf16NoBom(buf);
      if (noBomEnc !== null) {
        const text = decodeUtf16NoBom(buf, noBomEnc);
        const decodedProbe = text.slice(0, 8192);
        let decodedNonText = 0;
        for (let i = 0; i < decodedProbe.length; i++) {
          const code = decodedProbe.charCodeAt(i);
          if (code === 0) {
            return binaryRefusal(
              id,
              started,
              a.path,
              `NUL after ${noBomEnc} (no BOM) at char ${i}`
            );
          }
          if ((code < 9 || (code > 13 && code < 32)) && code < 128) decodedNonText++;
        }
        if (decodedProbe.length > 0 && decodedNonText > decodedProbe.length * 0.05) {
          return binaryRefusal(id, started, a.path, `${noBomEnc} no-BOM but >5% control bytes`);
        }
        buf = Buffer.from(text, 'utf8');
      } else {
      const probe = buf.subarray(0, Math.min(8192, buf.length));
      let nonText = 0;
      for (let i = 0; i < probe.length; i++) {
        const b = probe[i]!;
        if (b === 0) {
          return binaryRefusal(id, started, a.path, `NUL at offset ${i}`);
        }
        // Allow tab(9), LF(10), CR(13), printable ASCII (32–126), and any
        // byte ≥128 (UTF-8 continuation/lead). Everything else is suspect.
        if ((b < 9 || (b > 13 && b < 32)) && b < 128) nonText++;
      }
      if (probe.length > 0 && nonText > probe.length * 0.05) {
        return binaryRefusal(id, started, a.path, `${nonText} control bytes in first ${probe.length}`);
      }
      }
    }

    const text = buf.toString('utf8');
    const garbled = detectGarbledText(text);
    const lines = text.split('\n');
    const totalLines = lines.length;
    const requestedStart = a.startLine;
    const requestedEnd = a.endLine;
    if (requestedStart !== undefined && requestedStart > totalLines) {
      return {
        id,
        name: 'read',
        ok: false,
        output: `Error: startLine ${requestedStart} is past end of file (${totalLines} lines).`,
        error: 'invalid line range',
        durationMs: Date.now() - started
      };
    }
    if (requestedEnd !== undefined && requestedEnd < 1) {
      return {
        id,
        name: 'read',
        ok: false,
        output: 'Error: endLine must be at least 1.',
        error: 'invalid line range',
        durationMs: Date.now() - started
      };
    }
    const start = Math.max(1, requestedStart ?? 1);
    const end = Math.min(totalLines, requestedEnd ?? totalLines);
    if (start > end) {
      return {
        id,
        name: 'read',
        ok: false,
        output: `Error: invalid line range (${start}-${end}); file has ${totalLines} lines.`,
        error: 'invalid line range',
        durationMs: Date.now() - started
      };
    }
    const slice = lines.slice(start - 1, end);
    const numbered = slice
      .map((l, i) => `${String(start + i).padStart(5, ' ')}\t${l}`)
      .join('\n');
    const relPath = workspaceRelative(ctx.workspacePath, abs);

    const header =
      `# ${relPath} (lines ${start}-${end} of ${lines.length}${truncated ? ', TRUNCATED' : ''}${garbled ? ', GARBLED ENCODING' : ''})\n` +
      `# Each line: "^\\s*\\d+\\t" then file bytes — navigation only; strip before edit (host may auto-strip uniform blocks).` +
      (garbled
        ? '\n# Warning: decoded text may be garbled — verify encoding before editing.'
        : '');
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
        truncated,
        ...(garbled ? { garbled: true } : {})
      },
      durationMs: Date.now() - started
    };
  }
};

function binaryRefusal(
  id: string,
  started: number,
  path: string,
  detail?: string
): ToolResult {
  // Surface the detection reason in the structured `error` field so the
  // model can choose a recovery strategy (e.g. `bash` `sed` against a
  // specific offset, or skip the file entirely) instead of receiving
  // an opaque "binary file" label and giving up. The user-visible
  // `output` keeps the friendly phrasing.
  const error = detail ? `binary file (${detail})` : 'binary file';
  return {
    id,
    name: 'read',
    ok: false,
    output: `Refusing to read binary file: ${path}${detail ? ` (${detail})` : ''}`,
    error,
    durationMs: Date.now() - started
  };
}

/**
 * Byte-order-mark detection. Returns the canonical encoding name when
 * `buf` begins with a recognised BOM, or `null` when there is no BOM.
 * Order matters: UTF-32 (4-byte) BOMs must be checked BEFORE UTF-16
 * (2-byte) because the UTF-32 LE BOM `FF FE 00 00` shares its first
 * two bytes with the UTF-16 LE BOM `FF FE`.
 */
function detectBomEncoding(buf: Buffer): 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be' | null {
  if (buf.length >= 4) {
    if (buf[0] === 0xff && buf[1] === 0xfe && buf[2] === 0x00 && buf[3] === 0x00) return 'utf-32le';
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0xfe && buf[3] === 0xff) return 'utf-32be';
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8';
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
    if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  }
  return null;
}

/**
 * Decode a BOM-prefixed buffer to a string, stripping the BOM in the
 * process so the downstream line-slicer sees clean text. UTF-32
 * variants are not natively supported by Node's `TextDecoder` on every
 * runtime — fall back to a manual decode for those.
 */
function bomDecode(
  buf: Buffer,
  enc: 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be'
): string {
  if (enc === 'utf-8') {
    return buf.subarray(3).toString('utf8');
  }
  if (enc === 'utf-16le') {
    // Node Buffers expose a native UTF-16 LE decode under the alias
    // `'utf16le'`; skip the 2-byte BOM.
    return buf.subarray(2).toString('utf16le');
  }
  if (enc === 'utf-16be') {
    // Node doesn't decode UTF-16 BE directly; swap byte pairs and reuse
    // the LE decoder. The slice excludes the 2-byte BOM.
    const body = buf.subarray(2);
    const swapped = Buffer.alloc(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1]!;
      swapped[i + 1] = body[i]!;
    }
    return swapped.toString('utf16le');
  }
  // UTF-32 variants — rare in source code but possible. Manual decode
  // via code-point reconstruction.
  const body = buf.subarray(4);
  const out: string[] = [];
  for (let i = 0; i + 3 < body.length; i += 4) {
    const cp = enc === 'utf-32le'
      ? body[i]! | (body[i + 1]! << 8) | (body[i + 2]! << 16) | (body[i + 3]! << 24)
      : (body[i]! << 24) | (body[i + 1]! << 16) | (body[i + 2]! << 8) | body[i + 3]!;
    out.push(String.fromCodePoint(cp >>> 0));
  }
  return out.join('');
}

/**
 * Detect UTF-16 LE/BE without a BOM via alternating NUL-byte runs.
 * ASCII in UTF-16 LE is `char, 0x00, char, 0x00…`; BE is `0x00, char…`.
 */
function detectUtf16NoBom(buf: Buffer): 'utf-16le' | 'utf-16be' | null {
  const probeLen = Math.min(buf.length, 8192);
  if (probeLen < 4) return null;
  let oddNulls = 0;
  let evenNulls = 0;
  let oddPrintable = 0;
  let evenPrintable = 0;
  const pairs = Math.floor(probeLen / 2);
  for (let i = 0; i < probeLen; i++) {
    const b = buf[i]!;
    if (i % 2 === 0) {
      if (b === 0) evenNulls++;
      else if (b >= 32 && b < 127) evenPrintable++;
    } else {
      if (b === 0) oddNulls++;
      else if (b >= 32 && b < 127) oddPrintable++;
    }
  }
  if (pairs < 2) return null;
  if (oddNulls / pairs >= 0.35 && evenPrintable / pairs >= 0.25) return 'utf-16le';
  if (evenNulls / pairs >= 0.35 && oddPrintable / pairs >= 0.25) return 'utf-16be';
  return null;
}

function decodeUtf16NoBom(buf: Buffer, enc: 'utf-16le' | 'utf-16be'): string {
  if (enc === 'utf-16le') return buf.toString('utf16le');
  const swapped = Buffer.alloc(buf.length);
  for (let i = 0; i + 1 < buf.length; i += 2) {
    swapped[i] = buf[i + 1]!;
    swapped[i + 1] = buf[i]!;
  }
  return swapped.toString('utf16le');
}

/** Flag text that likely decoded with the wrong encoding. */
function detectGarbledText(text: string): boolean {
  const sample = text.slice(0, 8192);
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i]!;
    const code = sample.charCodeAt(i);
    if (code === 0 || ch === '?' || code === 0xfffd) suspicious++;
  }
  return suspicious / sample.length > 0.12;
}

/** Exported for unit tests; not part of the runtime public surface. */
export const __testing = {
  detectBomEncoding,
  bomDecode,
  detectUtf16NoBom,
  decodeUtf16NoBom,
  detectGarbledText
};
