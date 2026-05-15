/**
 * blobStore tests — content-addressing, dedup, read/write round-trip.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  hashContent,
  writeBlob,
  readBlob,
  hasBlob,
  iterateBlobs,
  deleteBlob
} from '../../../src/main/checkpoints/blobStore.js';

function freshWs(): string {
  return `ws-${randomUUID()}`;
}

describe('blobStore', () => {
  it('hashContent is deterministic and stable across calls', () => {
    const a = hashContent('hello world');
    const b = hashContent('hello world');
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex
  });

  it('writeBlob → readBlob round-trips content verbatim', async () => {
    const ws = freshWs();
    const body = 'line one\nline two\n';
    const hash = await writeBlob(ws, body);
    const read = await readBlob(ws, hash);
    expect(read).toBe(body);
  });

  it('writeBlob dedups identical content (idempotent)', async () => {
    const ws = freshWs();
    const body = 'console.log(1);\n';
    const h1 = await writeBlob(ws, body);
    const h2 = await writeBlob(ws, body);
    expect(h1).toBe(h2);
    expect(hasBlob(ws, h1)).toBe(true);
    // Iterator should yield exactly one.
    const seen: string[] = [];
    for await (const h of iterateBlobs(ws)) seen.push(h);
    expect(seen).toEqual([h1]);
  });

  it('readBlob returns null for missing hash', async () => {
    const ws = freshWs();
    const missing = await readBlob(ws, 'ff'.repeat(32));
    expect(missing).toBeNull();
  });

  it('deleteBlob is race-tolerant', async () => {
    const ws = freshWs();
    const hash = await writeBlob(ws, 'x');
    expect(await deleteBlob(ws, hash)).toBe(true);
    expect(await deleteBlob(ws, hash)).toBe(false);
    expect(await readBlob(ws, hash)).toBeNull();
  });
});
