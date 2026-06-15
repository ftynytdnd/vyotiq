import { describe, expect, it } from 'vitest';
import {
  extractPtyAgentLiveStdout,
  PtyAgentLiveStdoutTracker
} from '@shared/terminal/ptyAgentStream.js';
import { PTY_CMD_END_PREFIX, PTY_CMD_START } from '@shared/terminal/ptyMarkers.js';

describe('ptyAgentStream', () => {
  it('extracts stdout between PTY markers', () => {
    const buf = `noise\n${PTY_CMD_START}hello world${PTY_CMD_END_PREFIX}0\n`;
    expect(extractPtyAgentLiveStdout(buf)).toBe('hello world');
  });

  it('tracks incremental PTY stdout without duplication', () => {
    const tracker = new PtyAgentLiveStdoutTracker();
    expect(tracker.feed(`x${PTY_CMD_START}ab`)).toBe('ab');
    expect(tracker.feed('cd')).toBe('cd');
    expect(tracker.feed(`${PTY_CMD_END_PREFIX}0`)).toBe('');
  });
});
