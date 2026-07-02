import { describe, expect, it } from 'vitest';
import { formatGitIpcError } from '../../../src/renderer/lib/formatGitIpcError.js';

describe('formatGitIpcError', () => {
  it('unwraps electron invoke wrapper', () => {
    expect(
      formatGitIpcError(
        new Error(
          "Error invoking remote method 'workspace:git-generate-commit-message': Error: Configure a default or authoring model in Settings → Providers."
        )
      )
    ).toBe('Configure a default or authoring model in Settings → Providers.');
  });

  it('returns plain error messages unchanged', () => {
    expect(formatGitIpcError(new Error('No git remote configured.'))).toBe(
      'No git remote configured.'
    );
  });

  it('unwraps GitUserError invoke wrapper', () => {
    expect(
      formatGitIpcError(
        new Error(
          "Error invoking remote method 'workspace:git-generate-commit-message': GitUserError: No changes to summarize."
        )
      )
    ).toBe('No changes to summarize.');
  });
});
