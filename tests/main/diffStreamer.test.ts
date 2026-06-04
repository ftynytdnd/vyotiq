/**
 * Phase 2 — main-process FS-aware live diff streamer.
 *
 * Pins five invariants from the design rules documented on
 * `src/main/orchestrator/diffStreamer.ts`:
 *
 *   1. Emits a `diff-stream` event with real hunks when an `edit`
 *      call's `oldString` is found in the cached file body.
 *   2. Skips emission when the file is missing / unreadable; the
 *      renderer's synthesised preview remains the fallback.
 *   3. Skips emission when the parsed args don't yet describe a
 *      complete substitution (e.g. `oldString` is mid-stream).
 *   4. Coalesces consecutive deltas with identical args — no
 *      duplicate `diff-stream` events for the same snapshot.
 *   5. `dispose()` clears every per-call state so a long session
 *      doesn't leak cached file bodies.
 */

import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TimelineEvent } from '@shared/types/chat';
import { DiffStreamer } from '@main/orchestrator/diffStreamer';

interface CapturedEmit {
  emit: (event: TimelineEvent) => void;
  events: TimelineEvent[];
}

function captureEmits(): CapturedEmit {
  const events: TimelineEvent[] = [];
  return { emit: (event) => events.push(event), events };
}

async function mkTempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vyotiq-diffstreamer-'));
}

const FIVE_LINE_BODY = [
  'line one',
  'line two',
  'line three',
  'line four',
  'line five'
].join('\n');

async function waitUntil(assertion: () => void, timeoutMs = 500): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError) throw lastError;
  assertion();
}

describe('DiffStreamer', () => {
  it('emits a diff-stream event with real hunks when oldString matches the cached body', async () => {
    const workspacePath = await mkTempWorkspace();
    await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO' }
    });
    await waitUntil(() => {
      expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
    });
    const streamEvents = events.filter((e) => e.kind === 'diff-stream');
    const ev = streamEvents[0]!;
    if (ev.kind !== 'diff-stream') throw new Error('expected diff-stream');
    expect(ev.callId).toBe('c1');
    expect(ev.tool).toBe('edit');
    expect(ev.filePath).toBe('a.ts');
    expect(ev.additions).toBe(1);
    expect(ev.deletions).toBe(1);
    expect(ev.hunks.length).toBeGreaterThan(0);
    streamer.dispose();
  });

  it('skips emission when the parsed args lack oldString', async () => {
    const workspacePath = await mkTempWorkspace();
    await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts' }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(0);
    streamer.dispose();
  });

  it('skips emission when oldString cannot be found in the body yet', async () => {
    const workspacePath = await mkTempWorkspace();
    await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: {
        path: 'a.ts',
        oldString: 'not in the file at all',
        newString: 'unused'
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(0);
    streamer.dispose();
  });

  it('skips emission for missing files (renderer-side preview is the fallback)', async () => {
    const workspacePath = await mkTempWorkspace();
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'missing.ts', oldString: 'x', newString: 'y' }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(0);
    streamer.dispose();
  });

  it('coalesces consecutive deltas with identical args (no duplicate events)', async () => {
    const workspacePath = await mkTempWorkspace();
    await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    const args = { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO' };
    streamer.onArgsDelta({ callId: 'c1', name: 'edit', parsed: args });
    await waitUntil(() => {
      expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
    });
    streamer.onArgsDelta({ callId: 'c1', name: 'edit', parsed: args });
    streamer.onArgsDelta({ callId: 'c1', name: 'edit', parsed: args });
    await waitUntil(() => {
      expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
    });
    expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
    streamer.dispose();
  });

  it('re-emits when args change (model extends newString incrementally)', async () => {
    const workspacePath = await mkTempWorkspace();
    await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TW' }
    });
    await waitUntil(() => {
      expect(events.filter((e) => e.kind === 'diff-stream').length).toBeGreaterThanOrEqual(1);
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO' }
    });
    await waitUntil(() => {
      expect(events.filter((e) => e.kind === 'diff-stream').length).toBeGreaterThanOrEqual(2);
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO EXTRA' }
    });
    await waitUntil(() => {
      expect(events.filter((e) => e.kind === 'diff-stream').length).toBeGreaterThanOrEqual(2);
    });
    expect(events.filter((e) => e.kind === 'diff-stream').length).toBeGreaterThanOrEqual(2);
    streamer.dispose();
  });

  it('rejects paths that escape the workspace sandbox', async () => {
    const workspacePath = await mkTempWorkspace();
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: {
        path: '../../etc/passwd',
        oldString: 'root',
        newString: 'hacked'
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(0);
    streamer.dispose();
  });

  it('ignores non-edit / non-delete tool names', async () => {
    const workspacePath = await mkTempWorkspace();
    await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'read',
      parsed: { path: 'a.ts' }
    });
    streamer.onArgsDelta({
      callId: 'c2',
      name: 'search',
      parsed: { query: 'line two' }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(0);
    streamer.dispose();
  });

  it('uses the injected readFile dependency (deterministic test path)', async () => {
    const workspacePath = await mkTempWorkspace();
    // Need a real file on disk for the stat() inside loadBody to find
    // (we still bypass the actual read via the dep). Write a stub
    // sized below the cap so the stat-based skip doesn't fire.
    await writeFile(join(workspacePath, 'a.ts'), 'stub', 'utf8');
    const fakeBody = 'alpha\nbeta\ngamma';
    const readFile = vi.fn(async (_abs: string) => fakeBody);
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit,
      readFile
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts', oldString: 'beta', newString: 'BETA' }
    });
    await waitUntil(() => {
      expect(readFile).toHaveBeenCalledTimes(1);
      expect(events.find((e) => e.kind === 'diff-stream')).toBeDefined();
    });
    streamer.dispose();
  });

  it('notifySettled emits a settled marker, drops state, and ignores subsequent deltas', async () => {
    const workspacePath = await mkTempWorkspace();
    await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO' }
    });
    await waitUntil(() => {
      expect(events.filter((e) => e.kind === 'diff-stream').length).toBe(1);
    });
    expect(events.filter((e) => e.kind === 'diff-stream').length).toBe(1);
    streamer.notifySettled('c1');
    // Audit fix H8: `notifySettled` re-emits the cached hunks with
    // `settled: true` so the renderer flips to settled styling
    // without waiting for the authoritative `tool-call` to land.
    const settleEvents = events.filter(
      (e) => e.kind === 'diff-stream' && (e as { settled?: boolean }).settled === true
    );
    expect(settleEvents.length).toBe(1);
    expect(events.filter((e) => e.kind === 'diff-stream').length).toBe(2);
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO X' }
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    // Post-settle straggler is silently dropped — count unchanged.
    expect(events.filter((e) => e.kind === 'diff-stream').length).toBe(2);
    streamer.dispose();
  });

  describe('bash-write branch', () => {
    it('streams a heredoc cat-write as a full-file replacement diff', async () => {
      const workspacePath = await mkTempWorkspace();
      await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.onArgsDelta({
        callId: 'c1',
        name: 'bash',
        parsed: {
          command: `cat > a.ts << EOF\nbrand new line one\nbrand new line two\nEOF`
        }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      const streamEvents = events.filter((e) => e.kind === 'diff-stream');
      const ev = streamEvents[0]!;
      if (ev.kind !== 'diff-stream') throw new Error('expected diff-stream');
      expect(ev.tool).toBe('bash');
      expect(ev.filePath).toBe('a.ts');
      expect(ev.additions).toBeGreaterThan(0);
      expect(ev.deletions).toBeGreaterThan(0);
      streamer.dispose();
    });

    it('re-emits on heredoc-body growth during streaming', async () => {
      const workspacePath = await mkTempWorkspace();
      await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      // Streaming delta 1: heredoc opened, body partial.
      streamer.onArgsDelta({
        callId: 'c1',
        name: 'bash',
        parsed: { command: `cat > a.ts << EOF\npartial` }
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      // Streaming delta 2: body extended, still no terminator.
      streamer.onArgsDelta({
        callId: 'c1',
        name: 'bash',
        parsed: { command: `cat > a.ts << EOF\npartial\nmore lines` }
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      // Streaming delta 3: terminator arrived.
      streamer.onArgsDelta({
        callId: 'c1',
        name: 'bash',
        parsed: {
          command: `cat > a.ts << EOF\npartial\nmore lines\nEOF`
        }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream').length).toBeGreaterThanOrEqual(2);
      });
      const count = events.filter((e) => e.kind === 'diff-stream').length;
      // At least 2 distinct emits (the partial-body content changes,
      // terminator arrival may or may not change the hunks, but it
      // flips `complete` which we don't track on the event — the
      // hunks-content dedup is what matters here).
      expect(count).toBeGreaterThanOrEqual(2);
      streamer.dispose();
    });

    it('skips bash commands the parser cannot interpret (no `>`, piped, etc.)', async () => {
      const workspacePath = await mkTempWorkspace();
      await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.onArgsDelta({
        callId: 'c1',
        name: 'bash',
        parsed: { command: `ls -la` }
      });
      streamer.onArgsDelta({
        callId: 'c2',
        name: 'bash',
        parsed: { command: `cat a.ts | grep foo` }
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(0);
      streamer.dispose();
    });

    it('streams echo > path with trailing-newline semantics', async () => {
      const workspacePath = await mkTempWorkspace();
      await writeFile(join(workspacePath, 'greeting.txt'), 'old\n', 'utf8');
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.onArgsDelta({
        callId: 'c1',
        name: 'bash',
        parsed: { command: `echo 'new content' > greeting.txt` }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      const streamEvents = events.filter((e) => e.kind === 'diff-stream');
      if (streamEvents[0]!.kind !== 'diff-stream') throw new Error();
      expect(streamEvents[0]!.tool).toBe('bash');
      streamer.dispose();
    });
  });

  describe('create-true edit branch (sub-agent live create streaming)', () => {
    // Pins the Phase 3 fix: pre-fix the streamer silently returned for
    // any `edit` call with `create: true`, so for sub-agent file
    // creations no `diff-stream` event ever fired. That meant the
    // renderer's `ToolGroupRow.liveAutoExpand` (which gates on
    // `partial && diffStream != null`) stayed `false`, the rolled-up
    // sub-agent tool group never auto-expanded, and the renderer-side
    // `create-preview` (with the green-tinted `+` lines + trailing
    // `vyotiq-stream-cursor`) was hidden behind a collapsed row.
    // Post-fix the streamer emits a `diff-stream` with all-`+` hunks
    // synthesised against an empty before-body — no FS read needed,
    // no symlink ambient-authority concern (paths flow through the
    // create-aware sandbox guard).

    it('emits a diff-stream with all-`+` hunks for a create:true edit', async () => {
      const workspacePath = await mkTempWorkspace();
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.onArgsDelta({
        callId: 'c-create-1',
        name: 'edit',
        parsed: {
          path: 'src/new.ts',
          create: true,
          content: 'line A\nline B\nline C'
        }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      const streamEvents = events.filter(
        (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> => e.kind === 'diff-stream'
      );
      expect(streamEvents).toHaveLength(1);
      const ev = streamEvents[0]!;
      expect(ev.callId).toBe('c-create-1');
      expect(ev.tool).toBe('edit');
      expect(ev.filePath.endsWith('new.ts')).toBe(true);
      // Three `+` lines, zero deletions — fresh file is structurally
      // "everything added".
      expect(ev.additions).toBe(3);
      expect(ev.deletions).toBe(0);
      expect(ev.hunks).toHaveLength(1);
      const hunk = ev.hunks[0]!;
      expect(hunk.lines).toEqual([
        { kind: '+', text: 'line A' },
        { kind: '+', text: 'line B' },
        { kind: '+', text: 'line C' }
      ]);
      streamer.dispose();
    });

    it('re-emits with growing additions as the streaming `content` grows', async () => {
      const workspacePath = await mkTempWorkspace();
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      // Simulate three cumulative partial-JSON snapshots — same
      // shape `PartialJsonParser` produces for a `content` value
      // that arrives byte-by-byte across the wire.
      streamer.onArgsDelta({
        callId: 'c-stream',
        name: 'edit',
        parsed: { path: 'a.ts', create: true, content: 'one' }
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      streamer.onArgsDelta({
        callId: 'c-stream',
        name: 'edit',
        parsed: { path: 'a.ts', create: true, content: 'one\ntwo' }
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      streamer.onArgsDelta({
        callId: 'c-stream',
        name: 'edit',
        parsed: { path: 'a.ts', create: true, content: 'one\ntwo\nthree' }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream').length).toBe(3);
      });
      const streamEvents = events.filter(
        (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> => e.kind === 'diff-stream'
      );
      // Three distinct snapshots → three distinct emits (the
      // dedup gate on `argsHash` short-circuits identical
      // re-sends, but our three snapshots are strictly growing).
      expect(streamEvents.length).toBe(3);
      expect(streamEvents.map((e) => e.additions)).toEqual([1, 2, 3]);
      expect(streamEvents.every((e) => e.deletions === 0)).toBe(true);
      // All three frames flag the same callId — the renderer's
      // reducer overwrites `partialToolCallArgs[callId].diffStream`
      // with each frame, so the latest wins.
      expect(streamEvents.every((e) => e.callId === 'c-stream')).toBe(true);
      streamer.dispose();
    });

    it('coalesces identical create-true deltas (no duplicate emits)', async () => {
      const workspacePath = await mkTempWorkspace();
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      const args = { path: 'a.ts', create: true, content: 'hello\nworld' };
      streamer.onArgsDelta({ callId: 'c1', name: 'edit', parsed: args });
      streamer.onArgsDelta({ callId: 'c1', name: 'edit', parsed: { ...args } });
      streamer.onArgsDelta({ callId: 'c1', name: 'edit', parsed: { ...args } });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      const streamEvents = events.filter((e) => e.kind === 'diff-stream');
      streamer.dispose();
    });

    it('skips emit when path is missing or content is empty (still parsing)', async () => {
      const workspacePath = await mkTempWorkspace();
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      // No path yet — the partial-JSON parser hasn't reached the
      // `path` key. The streamer must not emit a hunks payload
      // bound to nothing.
      streamer.onArgsDelta({
        callId: 'c1',
        name: 'edit',
        parsed: { create: true, content: 'hello' }
      });
      // No content yet — same shape as above.
      streamer.onArgsDelta({
        callId: 'c2',
        name: 'edit',
        parsed: { path: 'a.ts', create: true }
      });
      // Empty-string content — would render as a single empty `+`
      // line (noise). Renderer-side preview also short-circuits.
      streamer.onArgsDelta({
        callId: 'c3',
        name: 'edit',
        parsed: { path: 'a.ts', create: true, content: '' }
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(0);
      streamer.dispose();
    });

    it('re-emits with settled:true on notifySettled (parity with modify branch)', async () => {
      const workspacePath = await mkTempWorkspace();
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.onArgsDelta({
        callId: 'c-settle',
        name: 'edit',
        parsed: { path: 'a.ts', create: true, content: 'x\ny\nz' }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      streamer.notifySettled('c-settle');
      const streamEvents = events.filter(
        (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> => e.kind === 'diff-stream'
      );
      // First emit (live) + second emit (settled re-emit).
      expect(streamEvents).toHaveLength(2);
      expect(streamEvents[0]!.settled).toBeUndefined();
      expect(streamEvents[1]!.settled).toBe(true);
      // Same hunk shape on both — the renderer's reducer just
      // flips the `settled` bit on the existing partial entry.
      expect(streamEvents[0]!.hunks).toEqual(streamEvents[1]!.hunks);
      streamer.dispose();
    });

    it('drops late deltas after notifySettled (post-settle straggler)', async () => {
      const workspacePath = await mkTempWorkspace();
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.onArgsDelta({
        callId: 'c-late',
        name: 'edit',
        parsed: { path: 'a.ts', create: true, content: 'x' }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      streamer.notifySettled('c-late');
      // A delta racing the settle MUST be dropped.
      streamer.onArgsDelta({
        callId: 'c-late',
        name: 'edit',
        parsed: { path: 'a.ts', create: true, content: 'x\ny' }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(2);
      });
      const streamEvents = events.filter((e) => e.kind === 'diff-stream');
      // Initial emit + settle re-emit = 2. The post-settle delta
      // is dropped by the `settledCallIds` gate at the top of
      // `handleCreateDelta`.
      expect(streamEvents).toHaveLength(2);
      streamer.dispose();
    });
  });

  describe('bash-create branch (heredoc / cat-write to a non-existent path)', () => {
    // Pins the companion fix to the create-true edit branch: bash
    // commands that create new files (`cat > newfile <<EOF…EOF`) hit
    // ENOENT in `loadBody`. Pre-fix this returned `null` →
    // `cur.closed = true` and the streamer never emitted, so a
    // sub-agent doing `bash` creates had the same auto-expand gap
    // as `edit { create: true }`. Post-fix `loadBody` returns `''`
    // for ENOENT specifically, so the LCS produces all-`+` hunks
    // against the empty before-body.

    it('emits a diff-stream with all-`+` hunks for a heredoc cat-write to a non-existent file', async () => {
      const workspacePath = await mkTempWorkspace();
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      const command = "cat > new.ts <<'EOF'\nalpha\nbeta\nEOF\n";
      streamer.onArgsDelta({
        callId: 'c-bash-create',
        name: 'bash',
        parsed: { command }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      const streamEvents = events.filter(
        (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> => e.kind === 'diff-stream'
      );
      expect(streamEvents).toHaveLength(1);
      const ev = streamEvents[0]!;
      expect(ev.tool).toBe('bash');
      expect(ev.filePath.endsWith('new.ts')).toBe(true);
      // The new file has 2 lines (`alpha`, `beta`) — additions
      // count must reflect that. The empty before-body's single
      // empty line surfaces as one `-` line in the LCS output, so
      // `deletions === 1` is acceptable on the bash path (the
      // create-true edit branch sidesteps the LCS by going through
      // `synthesizeCreateHunks` directly).
      expect(ev.additions).toBeGreaterThanOrEqual(2);
      expect(ev.deletions).toBeLessThanOrEqual(1);
      // Every `+` line should appear in the new content; the
      // important regression-resistance check is that the diff
      // FIRES at all (pre-fix it never did because `loadBody`
      // returned `null` for ENOENT and closed the call state).
      const plusTexts = ev.hunks.flatMap((h) =>
        h.lines.filter((l) => l.kind === '+').map((l) => l.text)
      );
      expect(plusTexts).toContain('alpha');
      expect(plusTexts).toContain('beta');
      streamer.dispose();
    });
  });

  describe('surrogate-callId reconciliation (provider id transitions mid-stream)', () => {
    // Pins the audit fix that closes the surrogate→real-id leak.
    //
    // Scenario: the provider's first `tool-call-args-delta` arrives
    // with `id: undefined`, so the orchestrator emits
    // events keyed by `pending:${owner}:${index}`. Mid-stream the
    // provider sends the real id; subsequent events use it
    // instead. Pre-fix, the streamer carried two distinct
    // `CallState` entries for the same logical call — one keyed
    // by the surrogate, one by the real id — and the surrogate
    // state was never reclaimed until run-end `dispose()`.
    //
    // Post-fix: when `notifySettled(realCallId, owner, index?)` is
    // called, the streamer walks for the matching
    // `pending:${owner}:${index}` (or the lowest-index surrogate
    // when index is omitted) and folds it into the real id —
    // re-emitting cached hunks under the real callId with
    // `settled: true` and dropping both keys.

    it('folds a surrogate-only state into the real callId on notifySettled with explicit index', async () => {
      const workspacePath = await mkTempWorkspace();
      await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      // ALL deltas in this scenario arrived under the surrogate id —
      // the provider never sent a real id during streaming. The
      // settle path is what discovers the real id.
      streamer.onArgsDelta({
        callId: 'pending:orc:0',
        name: 'edit',
        parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO' },
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      // One live diff-stream emit under the surrogate.
      const liveEvents = events.filter((e) => e.kind === 'diff-stream');
      expect(liveEvents).toHaveLength(1);
      expect(liveEvents[0]!.kind === 'diff-stream' && liveEvents[0]!.callId).toBe(
        'pending:orc:0'
      );

      // Now the authoritative `tool-call` lands with the real id.
      streamer.notifySettled('c-real-123', 'orc', 0);

      // Settle re-emit MUST land under the REAL id (not the
      // surrogate) and carry settled: true.
      const all = events.filter(
        (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> => e.kind === 'diff-stream'
      );
      expect(all).toHaveLength(2);
      expect(all[1]!.callId).toBe('c-real-123');
      expect(all[1]!.settled).toBe(true);
      // Same hunk shape on both — the renderer's reducer just
      // flips the `settled` bit on the existing partial entry the
      // surrogate→real `clearPartialFor` reconciles to.
      expect(all[0]!.hunks).toEqual(all[1]!.hunks);
      streamer.dispose();
    });

    it('folds the lowest-index surrogate when notifySettled is called without an explicit index', async () => {
      const workspacePath = await mkTempWorkspace();
      await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
      await writeFile(join(workspacePath, 'b.ts'), FIVE_LINE_BODY, 'utf8');
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      // Two parallel surrogate deltas under the same owner.
      streamer.onArgsDelta({
        callId: 'pending:orc:1',
        name: 'edit',
        parsed: { path: 'b.ts', oldString: 'line two', newString: 'LINE TWO B' },
      });
      streamer.onArgsDelta({
        callId: 'pending:orc:0',
        name: 'edit',
        parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO A' },
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream').length).toBeGreaterThanOrEqual(2);
      });
      // Settle the first authoritative tool-call with the LOWEST
      // surrogate index (mirrors the runtime ordering rule).
      streamer.notifySettled('c-real-A', 'orc');
      const settleEvents = events.filter(
        (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> =>
          e.kind === 'diff-stream' && e.settled === true
      );
      expect(settleEvents).toHaveLength(1);
      expect(settleEvents[0]!.callId).toBe('c-real-A');
      // The settled hunks correspond to the LOWEST-index (`pending:
      // sub-7:0` → `a.ts`), proving the lowest-index walk found
      // the right surrogate.
      expect(settleEvents[0]!.filePath).toBe('a.ts');
      // The OTHER surrogate (`pending:orc:1` → `b.ts`) is
      // untouched by the first settle — a subsequent settle would
      // claim it.
      streamer.notifySettled('c-real-B', 'orc');
      const allSettled = events.filter(
        (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> =>
          e.kind === 'diff-stream' && e.settled === true
      );
      expect(allSettled).toHaveLength(2);
      expect(allSettled[1]!.callId).toBe('c-real-B');
      expect(allSettled[1]!.filePath).toBe('b.ts');
      streamer.dispose();
    });

    it('drops post-settle stragglers on the surrogate id', async () => {
      const workspacePath = await mkTempWorkspace();
      await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.onArgsDelta({
        callId: 'pending:orc:0',
        name: 'edit',
        parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO' },
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      streamer.notifySettled('c-real', 'orc', 0);
      // A delta racing the settle on the SURROGATE id MUST be
      // dropped — both callIds were added to `settledCallIds`
      // during the fold-in.
      streamer.onArgsDelta({
        callId: 'pending:orc:0',
        name: 'edit',
        parsed: { path: 'a.ts', oldString: 'line three', newString: 'LINE THREE' },
      });
      // And the same protection for late deltas on the real id.
      streamer.onArgsDelta({
        callId: 'c-real',
        name: 'edit',
        parsed: { path: 'a.ts', oldString: 'line four', newString: 'LINE FOUR' },
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(2);
      });
      const total = events.filter((e) => e.kind === 'diff-stream').length;
      // Live emit (under surrogate) + settle re-emit (under real
      // id). No more.
      expect(total).toBe(2);
      streamer.dispose();
    });

    it('does not produce phantom surrogate state when the settle is a pure no-op (unknown callId)', async () => {
      // Pure idempotency: settling a callId the streamer never saw
      // and that has no matching surrogate must NOT introduce a
      // settled-callId entry that confuses a later real call. This
      // pins the original `notifySettled` no-op contract through
      // the surrogate-walk extension.
      const workspacePath = await mkTempWorkspace();
      await writeFile(join(workspacePath, 'a.ts'), FIVE_LINE_BODY, 'utf8');
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.notifySettled('c-never-seen', 'orc', 0);
      expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(0);
      // A subsequent legitimate call with a fresh id still works.
      streamer.onArgsDelta({
        callId: 'c-fresh',
        name: 'edit',
        parsed: { path: 'a.ts', oldString: 'line two', newString: 'LINE TWO' },
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream').length).toBeGreaterThanOrEqual(1);
      });
      expect(
        events.filter((e) => e.kind === 'diff-stream').length
      ).toBeGreaterThanOrEqual(1);
      streamer.dispose();
    });
  });

  it('isolates state per callId — two concurrent calls do not cross-contaminate', async () => {
    const workspacePath = await mkTempWorkspace();
    await mkdir(join(workspacePath, 'sub'), { recursive: true });
    await writeFile(join(workspacePath, 'a.ts'), 'foo\nbar\nbaz', 'utf8');
    await writeFile(join(workspacePath, 'sub', 'b.ts'), 'one\ntwo\nthree', 'utf8');
    const { emit, events } = captureEmits();
    const streamer = new DiffStreamer({
      workspacePath,
      runId: 'run-1',
      emit
    });
    streamer.onArgsDelta({
      callId: 'c1',
      name: 'edit',
      parsed: { path: 'a.ts', oldString: 'bar', newString: 'BAR' }
    });
    streamer.onArgsDelta({
      callId: 'c2',
      name: 'edit',
      parsed: { path: 'sub/b.ts', oldString: 'two', newString: 'TWO' }
    });
    await waitUntil(() => {
      expect(events.filter((e) => e.kind === 'diff-stream').length).toBeGreaterThanOrEqual(2);
    });
    const streams = events.filter(
      (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> => e.kind === 'diff-stream'
    );
    expect(streams.length).toBeGreaterThanOrEqual(2);
    const paths = new Set(streams.map((s) => s.filePath));
    expect(paths.has('a.ts')).toBe(true);
    // Workspace-relative path normalises separators on Windows.
    expect(Array.from(paths).some((p) => p.endsWith('b.ts'))).toBe(true);
    streamer.dispose();
  });

  describe('report branch (HTML deliverable live preview)', () => {
    it('emits a diff-stream with all-`+` hunks for a streaming report body', async () => {
      const workspacePath = await mkTempWorkspace();
      const { emit, events } = captureEmits();
      const streamer = new DiffStreamer({
        workspacePath,
        runId: 'run-1',
        emit
      });
      streamer.onArgsDelta({
        callId: 'c-report-1',
        name: 'report',
        parsed: {
          title: 'Project Health Survey',
          body: '<html>\n<body>Hello</body>\n</html>'
        }
      });
      await waitUntil(() => {
        expect(events.filter((e) => e.kind === 'diff-stream')).toHaveLength(1);
      });
      const ev = events.find(
        (e): e is Extract<TimelineEvent, { kind: 'diff-stream' }> => e.kind === 'diff-stream'
      );
      expect(ev?.tool).toBe('report');
      expect(ev?.filePath).toContain('.vyotiq/reports/');
      expect(ev?.additions).toBeGreaterThan(0);
      expect(ev?.deletions).toBe(0);
      streamer.dispose();
    });
  });
});
