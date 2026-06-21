import { describe, expect, it } from 'vitest';
import { DEFAULT_HEARTBEAT_WAKE_PROMPT } from '@main/heartbeat/defaultWakePrompt.js';

describe('DEFAULT_HEARTBEAT_WAKE_PROMPT', () => {
  it('steers away from repeating identical tool calls after wake', () => {
    expect(DEFAULT_HEARTBEAT_WAKE_PROMPT).toContain('<heartbeat_wake>');
    expect(DEFAULT_HEARTBEAT_WAKE_PROMPT).toContain('identical tools ran in the last 10 minutes');
    expect(DEFAULT_HEARTBEAT_WAKE_PROMPT).toContain('<run_progress>');
  });
});
