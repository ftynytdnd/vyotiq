import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findByteOffsetInFile,
  loadWindowedBodyAroundAnchor,
  sliceTextHeadWindow
} from '@main/orchestrator/diffStreamFileRead.js';

describe('sliceTextHeadWindow', () => {
  it('returns the full string when it fits the reference window', () => {
    expect(sliceTextHeadWindow('abc', 10)).toBe('abc');
  });

  it('trims to a line boundary when the reference window splits mid-line', () => {
    const text = 'line one\nline two\nline three\n';
    const referenceLen = 'line one\nline tw'.length;
    expect(sliceTextHeadWindow(text, referenceLen)).toBe('line one\n');
  });
});

describe('loadWindowedBodyAroundAnchor', () => {
  it('finds an anchor near the end of a multi-megabyte file', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'vyotiq-window-read-'));
    const marker = 'ANCHOR_LINE_FOR_EDIT\n';
    const padding = 'x'.repeat(1024 * 1024 + 1);
    const filePath = join(workspacePath, 'big.ts');
    await writeFile(filePath, padding + marker + 'tail\n', 'utf8');
    const fileStat = await stat(filePath);
    const anchor = await findByteOffsetInFile(filePath, marker);
    expect(anchor).not.toBeNull();
    const windowed = await loadWindowedBodyAroundAnchor(filePath, fileStat.size, marker);
    expect(windowed?.slice).toContain(marker);
  });

  it('returns a byte-accurate anchor before multi-byte UTF-8 content', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'vyotiq-window-utf8-'));
    const marker = 'ANCHOR_AFTER_EMOJI\n';
    const prefix = '🙂'.repeat(512);
    const filePath = join(workspacePath, 'utf8.ts');
    await writeFile(filePath, prefix + marker + 'tail\n', 'utf8');
    const fileStat = await stat(filePath);
    const anchor = await findByteOffsetInFile(filePath, marker);
    expect(anchor).toBe(Buffer.byteLength(prefix, 'utf8'));
    const windowed = await loadWindowedBodyAroundAnchor(filePath, fileStat.size, marker);
    expect(windowed?.slice).toContain(marker);
  });
});
