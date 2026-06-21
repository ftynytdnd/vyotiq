import { describe, expect, it } from 'vitest';
import { resizeSession, writeSession } from '@main/terminal/ptyManager.js';

describe('ptyManager unknown session errors', () => {
  it('writeSession throws for an unknown session id', () => {
    expect(() => writeSession('missing-session', 'hello')).toThrow(
      'Unknown terminal session: missing-session'
    );
  });

  it('resizeSession throws for an unknown session id', () => {
    expect(() => resizeSession('missing-session', 80, 24)).toThrow(
      'Unknown terminal session: missing-session'
    );
  });
});
