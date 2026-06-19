import { describe, expect, it } from 'vitest';
import { redactCaptureWindowTitle } from '@shared/capture/redactCaptureWindowTitle.js';

describe('redactCaptureWindowTitle', () => {
  it('leaves titles unchanged when disabled', () => {
    expect(redactCaptureWindowTitle('Chase — Sign in', false)).toBe('Chase — Sign in');
  });

  it('redacts sensitive-looking titles when enabled', () => {
    expect(redactCaptureWindowTitle('1Password', true)).toBe('Private window');
    expect(redactCaptureWindowTitle('My Bank Account', true)).toBe('Private window');
  });
});
