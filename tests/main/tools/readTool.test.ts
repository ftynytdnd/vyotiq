/**
 * `read` tool binary-detection tests. Pins the BOM-aware exemption so
 * a UTF-16-encoded source file (PowerShell `Out-File` default, some
 * Windows editors) is still readable instead of being labelled "binary
 * file" because its ASCII bytes are NUL-paired by the encoding.
 *
 * Genuine binaries (no BOM, NULs in the body) must still be refused.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTool } from '@main/tools/read.tool';
import type { ToolContext } from '@main/tools/types';

function ctxFor(workspacePath: string): ToolContext {
  return {
    workspacePath,
    workspaceId: 'ws',
    runId: 'r',
    conversationId: 'c',
    strictApprovals: false,
    emit: () => undefined,
    signal: new AbortController().signal,
  };
}

describe('read.tool BOM detection', () => {
  let ws = '';
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'vyotiq-read-'));
  });
  afterEach(async () => {
    try { await rm(ws, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('reads a UTF-16 LE BOM file as text instead of refusing it as binary', async () => {
    const body =
      'export const greeting = "hello";\nexport const farewell = "bye";\n';
    // UTF-16 LE BOM (FF FE) + UTF-16 LE encoded body. Node's
    // `Buffer.from(str, 'utf16le')` writes the LE form natively.
    const bom = Buffer.from([0xff, 0xfe]);
    const encoded = Buffer.concat([bom, Buffer.from(body, 'utf16le')]);
    const target = join(ws, 'greeting.ts');
    await fs.writeFile(target, encoded);

    const result = await readTool.run({ path: 'greeting.ts' }, ctxFor(ws));
    expect(result.ok).toBe(true);
    // The decoded output should contain the text body, NOT the raw
    // NUL bytes from the UTF-16 encoding.
    expect(result.output).toContain('export const greeting = "hello";');
    expect(result.output).toContain('export const farewell = "bye";');
    // And the structured `error` field should be absent.
    expect(result.error).toBeUndefined();
  });

  it('reads a UTF-16 LE file without BOM via alternating-null heuristic', async () => {
    const body = 'const legacy = true;\n';
    const encoded = Buffer.from(body, 'utf16le');
    const target = join(ws, 'legacy-no-bom.ps1');
    await fs.writeFile(target, encoded);

    const result = await readTool.run({ path: 'legacy-no-bom.ps1' }, ctxFor(ws));
    expect(result.ok).toBe(true);
    expect(result.output).toContain('const legacy = true;');
  });

  it('returns ok:false when startLine is past end of file', async () => {
    const body = 'line one\nline two\n';
    await fs.writeFile(join(ws, 'small.txt'), body, 'utf8');

    const result = await readTool.run({ path: 'small.txt', startLine: 32001 }, ctxFor(ws));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/past end of file/i);
    expect(result.error).toBe('invalid line range');
  });

  it('reads a UTF-8 BOM file (EF BB BF) without choking on the BOM', async () => {
    const body = 'const answer = 42;\n';
    const encoded = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(body, 'utf8')
    ]);
    const target = join(ws, 'answer.ts');
    await fs.writeFile(target, encoded);

    const result = await readTool.run({ path: 'answer.ts' }, ctxFor(ws));
    expect(result.ok).toBe(true);
    expect(result.output).toContain('const answer = 42;');
  });

  it('still refuses a true binary (no BOM, NUL in body)', async () => {
    const body = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x00, 0x01, 0x02, 0x03]); // fake GIF-ish
    const target = join(ws, 'image.bin');
    await fs.writeFile(target, body);

    const result = await readTool.run({ path: 'image.bin' }, ctxFor(ws));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/binary file/);
    // Offset of the first NUL should be surfaced so the model has a
    // recovery hint instead of an opaque label.
    expect(result.error).toMatch(/offset \d+/);
  });

  it('refuses a file that opens with a BOM but contains NULs after decoding', async () => {
    // UTF-16 LE BOM + a body that decodes to a NUL-containing string.
    // Each character is encoded as 2 bytes, so a NUL character is
    // [0x00, 0x00].
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from(
      'hello\u0000world',
      'utf16le'
    );
    const target = join(ws, 'fakeutf16.bin');
    await fs.writeFile(target, Buffer.concat([bom, body]));

    const result = await readTool.run({ path: 'fakeutf16.bin' }, ctxFor(ws));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/binary file/);
    // The detail should mention the BOM-aware decode.
    expect(result.error).toMatch(/utf-16le/);
  });

  it('suggests similar top-level dirs on ENOENT when parent is missing', async () => {
    await fs.mkdir(join(ws, 'transport'), { recursive: true });
    const result = await readTool.run(
      { path: 'transports/client.py' },
      ctxFor(ws)
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Similar at workspace root:.*transport/i);
  });
});
