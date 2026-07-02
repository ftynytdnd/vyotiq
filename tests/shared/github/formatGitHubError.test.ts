import { describe, expect, it } from 'vitest';
import {
  formatGitHubIpcError,
  GITHUB_OAUTH_NOT_CONFIGURED_MESSAGE
} from '../../../src/shared/github/formatGitHubError.js';
import { unwrapIpcInvokeError } from '../../../src/shared/ipc/unwrapIpcInvokeError.js';

describe('unwrapIpcInvokeError', () => {
  it('extracts inner Error message from invoke wrapper', () => {
    const raw =
      "Error invoking remote method 'github:accounts:start-device': Error: GitHub OAuth is not configured.";
    expect(unwrapIpcInvokeError(raw)).toBe('GitHub OAuth is not configured.');
  });
});

describe('formatGitHubIpcError', () => {
  it('maps oauth-not-configured to friendly copy', () => {
    const err = new Error(
      "Error invoking remote method 'github:accounts:start-device': Error: GitHub browser sign-in is not available in this build. Connect with a personal access token instead."
    );
    expect(formatGitHubIpcError(err)).toBe(GITHUB_OAUTH_NOT_CONFIGURED_MESSAGE);
  });
});
