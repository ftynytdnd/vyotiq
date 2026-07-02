import { describe, expect, it } from 'vitest';
import {
  parseRemoteList,
  pickDefaultRemote,
  remoteFromUpstreamRef
} from '../../../src/main/workspace/workspaceGitRemote.js';

describe('workspaceGitRemote', () => {
  it('parses remote list lines', () => {
    expect(parseRemoteList('origin\nupstream\n')).toEqual(['origin', 'upstream']);
  });

  it('prefers origin when picking default remote', () => {
    expect(pickDefaultRemote(['upstream', 'origin'])).toBe('origin');
    expect(pickDefaultRemote(['upstream'])).toBe('upstream');
    expect(pickDefaultRemote([])).toBeNull();
  });

  it('extracts remote from upstream ref', () => {
    expect(remoteFromUpstreamRef('origin/main')).toBe('origin');
    expect(remoteFromUpstreamRef('upstream')).toBeNull();
  });
});
