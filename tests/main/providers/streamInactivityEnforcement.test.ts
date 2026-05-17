/**
 * Review finding M3 — `STREAM_INACTIVITY_TIMEOUT_MS` is surfaced in
 * `<runtime_limits>` so the orchestrator can self-reason about how
 * long a quiet provider can stall before the host retries. The
 * harness only stays honest when EVERY transport actually enforces
 * the timeout.
 *
 * This test is a structural pin: both shipped chat transports
 * (`openaiChatStream`, `ollamaChatStream`) MUST import
 * `createInactivityWatch` from `streamInactivity.ts`. The watchdog
 * implementation itself has dedicated tests in
 * `streamInactivity.test.ts`; this file just guarantees the wiring
 * stays in place across refactors.
 *
 * If a future transport replaces `createInactivityWatch` with its own
 * timer (or removes it entirely), this test fails and forces the
 * author to either rewire the new path or update the harness's
 * `<runtime_limits>` claim.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

async function readSource(rel: string): Promise<string> {
  return fs.readFile(join(ROOT, rel), 'utf8');
}

describe('STREAM_INACTIVITY_TIMEOUT_MS enforcement (M3)', () => {
  it('openaiChatStream wires createInactivityWatch around fetch + reader.read', async () => {
    const src = await readSource('src/main/providers/openaiChatStream.ts');
    expect(src).toContain("from './streamInactivity.js'");
    expect(src).toContain('createInactivityWatch(');
    // The watchdog must wrap BOTH the headers fetch (pre-stream) and
    // the body reader.read() loop. Each phase needs its own
    // `isStreamInactivityError` check so the structured log line
    // distinguishes "stalled during connect" from "stalled mid-stream".
    expect(src).toMatch(/inactive before headers/);
    expect(src).toMatch(/inactive mid-read/);
  });

  it('ollamaChatStream wires createInactivityWatch around fetch + reader.read', async () => {
    const src = await readSource('src/main/providers/ollamaChatStream.ts');
    expect(src).toContain("from './streamInactivity.js'");
    expect(src).toContain('createInactivityWatch(');
    expect(src).toMatch(/inactive before headers/);
    expect(src).toMatch(/inactive mid-read/);
  });

  it('streamInactivity.ts defaults to STREAM_INACTIVITY_TIMEOUT_MS', async () => {
    const src = await readSource('src/main/providers/streamInactivity.ts');
    // The default branch reads from the shared constant — a future
    // refactor that hard-codes a literal here would silently disable
    // the harness's source-of-truth contract.
    expect(src).toContain("import { STREAM_INACTIVITY_TIMEOUT_MS } from '@shared/constants.js'");
    expect(src).toContain('opts.timeoutMs ?? STREAM_INACTIVITY_TIMEOUT_MS');
  });

  it('harness runtime_limits block cites the same constant', async () => {
    const src = await readSource('src/main/harness/harnessLoader.ts');
    // The block prints `STREAM_INACTIVITY_TIMEOUT_MS=...` so the
    // model can reason about the timeout numerically. If the line
    // disappears the prose will start to lie.
    expect(src).toContain('`STREAM_INACTIVITY_TIMEOUT_MS=${STREAM_INACTIVITY_TIMEOUT_MS}`');
  });
});
