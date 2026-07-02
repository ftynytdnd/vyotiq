/**
 * Provider account poll source registry — multi-holder OR semantics.
 */

import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __test_resetProviderAccountPollRegistrations,
  useProviderAccountPollSource
} from '@renderer/lib/useProviderAccountPollSource';

const setAccountPollSource = vi.fn(async () => undefined);

vi.mock('@renderer/lib/ipc.js', async () => {
  const stub = window.vyotiq;
  return {
    vyotiq: {
      ...stub,
      providers: {
        ...stub.providers,
        setAccountPollSource: (...args: unknown[]) => setAccountPollSource(...args)
      }
    }
  };
});

function PollHolder({ source, active }: { source: 'composer' | 'agent-run'; active: boolean }) {
  useProviderAccountPollSource(source, active);
  return null;
}

beforeEach(() => {
  __test_resetProviderAccountPollRegistrations();
  setAccountPollSource.mockClear();
});

describe('useProviderAccountPollSource', () => {
  it('activates and deactivates a source', () => {
    const { unmount } = render(<PollHolder source="agent-run" active />);
    expect(setAccountPollSource).toHaveBeenCalledWith('agent-run', true);

    act(() => unmount());
    expect(setAccountPollSource).toHaveBeenCalledWith('agent-run', false);
  });

  it('keeps source active while any holder is active', () => {
    const { rerender } = render(
      <>
        <PollHolder source="composer" active />
        <PollHolder source="composer" active={false} />
      </>
    );
    expect(setAccountPollSource).toHaveBeenCalledWith('composer', true);

    rerender(
      <>
        <PollHolder source="composer" active />
        <PollHolder source="composer" active />
      </>
    );
    expect(setAccountPollSource).toHaveBeenCalledWith('composer', true);
  });
});
