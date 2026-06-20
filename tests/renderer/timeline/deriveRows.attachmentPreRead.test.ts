import { describe, expect, it } from 'vitest';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import type { TimelineEvent } from '@shared/types/chat';

describe('deriveRows — attachment-pre-read', () => {
  it('renders after the user prompt with vision-oriented copy', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'user-prompt',
        id: 'u1',
        ts: 1,
        content: 'See attached screenshot.',
        runId: 'run-1'
      },
      {
        kind: 'attachment-pre-read',
        id: 'a1',
        ts: 2,
        path: '.vyotiq/captures/window-1.png',
        mediaKind: 'image',
        runId: 'run-1'
      }
    ];

    const rows = deriveRows(events);
    const promptIdx = rows.findIndex((r) => r.kind === 'user-prompt');
    const noticeIdx = rows.findIndex((r) => r.kind === 'agent-thought');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(noticeIdx).toBeGreaterThan(promptIdx);

    const notice = rows[noticeIdx];
    expect(notice?.kind).toBe('agent-thought');
    if (notice?.kind === 'agent-thought') {
      expect(notice.variant).toBe('notice');
      expect(notice.content).toContain('sent to vision');
      expect(notice.content).toContain('.vyotiq/captures/window-1.png');
    }
  });
});
