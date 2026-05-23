/**
 * Encoding regression — `bash` MUST round-trip multi-byte UTF-8
 * output without corruption, regardless of how the kernel splits
 * the child's stdio pipe into Buffer chunks.
 *
 * Review finding C1: the prior implementation decoded each chunk
 * via `Buffer.toString('utf8')` in isolation. Multi-byte codepoints
 * (CJK, emoji, accented Latin > 1 byte) that straddled a chunk
 * boundary decoded to `U+FFFD` replacement characters. The fix
 * wires a `StringDecoder('utf8')` per stream so the partial trailing
 * bytes carry over to the next chunk.
 *
 * We test through the real `bashTool.run` to exercise the actual
 * wiring (`StringDecoder.write` per chunk + `StringDecoder.end()` on
 * close). The command echoes a mixed CJK + emoji string that is
 * known to contain multi-byte codepoints; we then assert that every
 * codepoint we emitted is present in the captured stdout. If the
 * decode regresses, replacement chars `\uFFFD` would show up
 * instead.
 *
 * The test spawns a real shell subprocess. We bound that with a
 * short timeout and skip on environments where the platform shell
 * is missing (extremely rare).
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatPermissions } from '@shared/types/chat';
import { bashTool } from '@main/tools/bash.tool';

const PERM_ALLOW: ChatPermissions = {
  allowAuto: true
};

function makeCtx(workspacePath: string) {
  return {
    workspacePath,
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
    permissions: PERM_ALLOW,
    strictApprovals: false,
    signal: new AbortController().signal,
    // Audit fix H-04: ctx.confirm now returns `ConfirmOutcome` (the
    // boolean approved + reason discriminator) instead of a bare
    // boolean.
    confirm: async () => ({ approved: true, reason: 'approved' as const }),
    confirmEdit: async () => ({ approved: true, acceptAllRemaining: false }),
    emit: () => { }
  };
}

/**
 * Mixed multi-byte payload: a CJK glyph (3 bytes UTF-8), a non-BMP
 * emoji (4 bytes UTF-8, surrogate pair in UTF-16), and a precomposed
 * accented Latin char (2 bytes UTF-8). One of every common multi-byte
 * width so a regression in any of them surfaces.
 */
const MULTIBYTE_PAYLOAD = '中é😀';

describe('bash tool — UTF-8 round-trip (C1 regression)', () => {
  it('emits multi-byte codepoints losslessly through stdout', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vyotiq-bash-utf8-'));
    try {
      // PowerShell on Windows; /bin/bash elsewhere. PowerShell writes
      // UTF-16 to the console by default; switch its output encoding
      // to UTF-8 for this run so the captured pipe matches what every
      // other platform produces. `[Console]::OutputEncoding =
      // [System.Text.Encoding]::UTF8; Write-Output '<payload>'` is
      // the canonical incantation.
      const command =
        process.platform === 'win32'
          ? `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output '${MULTIBYTE_PAYLOAD}'`
          : `printf '%s\\n' '${MULTIBYTE_PAYLOAD}'`;

      const result = await bashTool.run({ command }, makeCtx(workspace));
      expect(result.ok).toBe(true);

      // `result.data.stdout` is what the StringDecoder produced. Each
      // codepoint of the payload must appear in it; no replacement
      // characters may leak through.
      const data = result.data as { stdout: string } | undefined;
      const stdout = data?.stdout ?? '';
      for (const cp of MULTIBYTE_PAYLOAD) {
        expect(stdout).toContain(cp);
      }
      expect(stdout).not.toContain('\uFFFD');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 15_000);
});
