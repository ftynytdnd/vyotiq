import { describe, expect, it } from 'vitest';
import { resolveStickyFooterLiveLabel } from '@renderer/components/timeline/shared/resolveStickyFooterLiveLabel.js';

describe('resolveStickyFooterLiveLabel', () => {
  it('shows awaiting headline when ask_user is pending', () => {
    const { headline } = resolveStickyFooterLiveLabel({
      awaitingAskUser: true,
      fileEditCount: 0,
      elapsedMs: 4000,
      tokenLabel: '10.2k'
    });
    expect(headline).toBe('Awaiting your answer');
  });

  it('maps running-tool phase to Exploring when tool is unknown', () => {
    const { headline } = resolveStickyFooterLiveLabel({
      awaitingAskUser: false,
      latestStatus: {
        kind: 'run-status',
        id: 'rs-1',
        phase: 'running-tool',
        label: 'Running tool',
        ts: 1
      },
      fileEditCount: 2,
      elapsedMs: 8000,
      tokenLabel: null
    });
    expect(headline).toBe('Exploring');
  });

  it('maps running-tool read invocations to Reading', () => {
    const { headline } = resolveStickyFooterLiveLabel({
      awaitingAskUser: false,
      latestStatus: {
        kind: 'run-status',
        id: 'rs-2',
        phase: 'running-tool',
        label: 'Exploring',
        ts: 1,
        detail: { toolName: 'read' }
      },
      fileEditCount: 0,
      elapsedMs: 3000,
      tokenLabel: '12k'
    });
    expect(headline).toBe('Reading');
  });

  it('prefers live streaming text over awaiting-response status', () => {
    const { headline } = resolveStickyFooterLiveLabel({
      awaitingAskUser: false,
      latestStatus: {
        kind: 'run-status',
        id: 'rs-3',
        phase: 'awaiting-response',
        label: 'Awaiting first token…',
        ts: 1
      },
      activity: { streamingText: true },
      fileEditCount: 0,
      elapsedMs: 2000,
      tokenLabel: null
    });
    expect(headline).toBe('Writing');
  });

  it('uses the provider connecting label when idle', () => {
    const { headline } = resolveStickyFooterLiveLabel({
      awaitingAskUser: false,
      latestStatus: {
        kind: 'run-status',
        id: 'rs-4',
        phase: 'connecting',
        label: 'Connecting to Ollama Cloud…',
        ts: 1
      },
      fileEditCount: 0,
      elapsedMs: 5000,
      tokenLabel: '177.6k'
    });
    expect(headline).toBe('Connecting to Ollama Cloud');
  });
});
