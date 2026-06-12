/**
 * Replay must honor reversible-compaction markers: a `tool-result` whose
 * `toolCallId` has a matching `tool-compacted` event is rebuilt as the
 * lean banner (pointing at the on-disk artifact) instead of the full
 * output. This keeps cross-turn memory at the same lean ceiling the live
 * run reached; the model restores the artifact on demand via `read`.
 */

import { describe, expect, it } from 'vitest';
import { replayTranscript } from '@main/orchestrator/replay/replayTranscript';
import { isCompactedToolContent } from '@main/orchestrator/context/compactionArtifacts';
import type { TimelineEvent } from '@shared/types/chat';

let n = 1;
const ts = () => n++;

describe('replayTranscript — context compaction', () => {
  it('rebuilds a compacted tool result as a banner pointing at the artifact', () => {
    const fullOutput = 'BIG-'.repeat(5_000);
    const rel = '.vyotiq/compaction/conv-1/run-1/call-1.txt';

    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: ts(), content: 'read the file' },
      { kind: 'agent-text-delta', id: 'a1', ts: ts(), delta: 'reading' },
      {
        kind: 'tool-call',
        id: 'a1',
        ts: ts(),
        call: { id: 'call-1', name: 'read' as never, args: { path: 'big.txt' } }
      },
      {
        kind: 'tool-result',
        id: 'tr1',
        ts: ts(),
        result: { id: 'call-1', name: 'read' as never, ok: true, output: fullOutput, durationMs: 1 }
      },
      // Compaction fired in a later iteration, persisted this marker.
      {
        kind: 'tool-compacted',
        id: 'tcm1',
        ts: ts(),
        runId: 'run-1',
        toolCallId: 'call-1',
        relativePath: rel,
        originalChars: fullOutput.length
      }
    ];

    const messages = replayTranscript(events);
    const toolMsg = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'call-1');
    expect(toolMsg).toBeDefined();
    expect(typeof toolMsg!.content).toBe('string');
    expect(isCompactedToolContent(toolMsg!.content as string)).toBe(true);
    expect(toolMsg!.content as string).toContain(rel);
    // The fat output must NOT be reconstructed.
    expect((toolMsg!.content as string).length).toBeLessThan(fullOutput.length);
  });

  it('leaves uncompacted tool results untouched', () => {
    const output = 'small output';
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: ts(), content: 'read the file' },
      {
        kind: 'tool-call',
        id: 'a1',
        ts: ts(),
        call: { id: 'call-2', name: 'read' as never, args: { path: 'small.txt' } }
      },
      {
        kind: 'tool-result',
        id: 'tr1',
        ts: ts(),
        result: { id: 'call-2', name: 'read' as never, ok: true, output, durationMs: 1 }
      }
    ];
    const messages = replayTranscript(events);
    const toolMsg = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'call-2');
    expect(toolMsg!.content).toBe(output);
  });
});
