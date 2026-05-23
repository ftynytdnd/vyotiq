/**
 * Sandbox regression — `inlineFiles` MUST route every attachment path
 * through `resolveInsideWorkspace` before touching the filesystem.
 *
 * Why this test exists (audit finding 1.1 / plan §6.12):
 *   `ChatSendInput.attachments` is renderer-controlled. Before the fix,
 *   `contextManager.inlineFiles` used `path.join(workspacePath, rel)`
 *   which cheerfully collapses `..` segments and lets an attachment
 *   path like `"../../.ssh/id_rsa"` escape the workspace. The file's
 *   contents would then be inlined into the user prompt sent to the
 *   configured LLM provider — a direct violation of the "never transmit
 *   local file contents … to external servers" Prime Directive.
 *
 *   The post-fix contract: paths that escape the workspace (relative
 *   traversals OR absolute paths outside the root) must emit an
 *   `<file ... error=... />` marker and NEVER read the target file.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineFiles } from '@main/orchestrator/contextManager';

let workspace: string;
let outside: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(join(tmpdir(), 'vyotiq-inline-ws-'));
  outside = await fs.mkdtemp(join(tmpdir(), 'vyotiq-inline-out-'));
  await fs.mkdir(join(workspace, 'sub'), { recursive: true });
  await fs.writeFile(join(workspace, 'sub', 'ok.txt'), 'inside-contents');
  // Write the would-be-exfiltrated secret outside the workspace so the
  // negative cases have something to FAIL on. The test asserts its
  // contents never appear in the envelope output.
  await fs.writeFile(join(outside, 'secret.txt'), 'SUPER-SECRET-DO-NOT-LEAK');
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe('inlineFiles — sandbox', () => {
  it('inlines files that resolve inside the workspace', async () => {
    const out = await inlineFiles(workspace, ['sub/ok.txt']);
    expect(out).toContain('<file path="sub/ok.txt">');
    expect(out).toContain('inside-contents');
    expect(out).not.toContain('error=');
  });

  it('rejects ../ traversal with an error marker (no read)', async () => {
    const out = await inlineFiles(workspace, ['../secret.txt']);
    // The envelope must mention the escape attempt by path but must
    // never contain the secret payload — that's the whole point.
    expect(out).toContain('<file path="../secret.txt"');
    expect(out).toContain('error=');
    expect(out).not.toContain('SUPER-SECRET-DO-NOT-LEAK');
  });

  it('rejects deep ../ traversal that would escape to the OS root', async () => {
    const out = await inlineFiles(workspace, ['../../../../../etc/passwd']);
    expect(out).toContain('error=');
    // No raw `/etc/passwd` contents leak even on systems where the
    // file exists — the guard fires before the read.
    expect(out).not.toMatch(/root:x:0:0/);
  });

  it('rejects an absolute path that lives outside the workspace', async () => {
    const abs = join(outside, 'secret.txt');
    const out = await inlineFiles(workspace, [abs]);
    expect(out).toContain('error=');
    expect(out).not.toContain('SUPER-SECRET-DO-NOT-LEAK');
  });

  it('processes a mix of safe + unsafe paths without bailing on the first error', async () => {
    const out = await inlineFiles(workspace, [
      'sub/ok.txt',
      '../secret.txt',
      'sub/ok.txt'
    ]);
    // Both safe reads land; the unsafe one emits an error marker
    // sandwiched between them. Ordering is preserved so the model
    // sees attachments in the same order the user attached them.
    const okCount = (out.match(/inside-contents/g) ?? []).length;
    expect(okCount).toBe(2);
    expect(out).toContain('error=');
    expect(out).not.toContain('SUPER-SECRET-DO-NOT-LEAK');
  });

  it('returns empty string for an empty attachment list', async () => {
    const out = await inlineFiles(workspace, []);
    expect(out).toBe('');
  });

  /**
   * Inline-cap regression (audit Phase 11 / G1).
   *
   * Files larger than the per-file character cap used to be silently
   * sliced — the worker read the partial body as if it were the whole
   * file and could hallucinate about content past the cap. Pin the new
   * contract: oversized files must emit a TRUNCATED marker INSIDE the
   * `<file>` body so the model sees the cut-off explicitly.
   */
  it('emits a TRUNCATED marker when a file exceeds the inline cap', async () => {
    // 32 001 chars — one byte past the 32 000 cap. Use a repeating
    // ASCII-printable pattern so the slice is stable and the assertion
    // can match a fragment of the head deterministically.
    const big = 'a'.repeat(32_001);
    await fs.writeFile(join(workspace, 'sub', 'big.txt'), big);
    try {
      const out = await inlineFiles(workspace, ['sub/big.txt']);
      expect(out).toContain('<file path="sub/big.txt">');
      // Marker must appear and must clearly indicate partial content.
      expect(out).toContain('TRUNCATED');
      expect(out).toMatch(/exceeds the inline cap/);
      // Head of the file is preserved.
      expect(out).toContain('a'.repeat(64));
    } finally {
      await fs.rm(join(workspace, 'sub', 'big.txt'), { force: true });
    }
  });

  it('does NOT emit the TRUNCATED marker for files under the cap', async () => {
    // Sized just under the cap to prove the boundary condition.
    const small = 'b'.repeat(31_999);
    await fs.writeFile(join(workspace, 'sub', 'medium.txt'), small);
    try {
      const out = await inlineFiles(workspace, ['sub/medium.txt']);
      expect(out).toContain('<file path="sub/medium.txt">');
      expect(out).not.toContain('TRUNCATED');
    } finally {
      await fs.rm(join(workspace, 'sub', 'medium.txt'), { force: true });
    }
  });

  /**
   * Abort-signal regression (audit fix 2026-08-P2-1 / 13-P2-1).
   *
   * Pre-fix `inlineFiles` ignored the run's abort signal — a user who
   * aborted a `chat:send` with a 50-file delegate spec would still pay
   * the full FS cost of reading every attachment before the prompt
   * assembly bailed out. The post-fix contract: when the signal is
   * pre-aborted (or fires during the realpath/read), every still-
   * pending slot collapses to a cheap `(aborted before read)` marker
   * without touching the FS.
   */
  it('emits the aborted marker for every slot when the signal is pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await inlineFiles(
      workspace,
      ['sub/ok.txt', 'sub/ok.txt'],
      undefined,
      controller.signal
    );
    // Both slots must render the aborted marker; NEITHER must contain
    // the file body — otherwise we paid the FS cost we were trying
    // to avoid.
    expect(out).not.toContain('inside-contents');
    const markerCount = (out.match(/aborted before read/g) ?? []).length;
    expect(markerCount).toBe(2);
  });

  it('still resolves cleanly when an unaborted signal is passed', async () => {
    // Belt-and-suspenders — passing a NON-aborted signal must behave
    // identically to omitting it. Without this, the abort wiring could
    // silently degrade the happy path.
    const controller = new AbortController();
    const out = await inlineFiles(
      workspace,
      ['sub/ok.txt'],
      undefined,
      controller.signal
    );
    expect(out).toContain('<file path="sub/ok.txt">');
    expect(out).toContain('inside-contents');
    expect(out).not.toContain('aborted before read');
  });
});
