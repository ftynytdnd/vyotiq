import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DetailShell } from '@renderer/components/timeline/shared/DetailShell';

describe('DetailShell variants', () => {
  it('differentiates flush (tight) from flat (spaced)', () => {
    const { container: flush } = render(
      <DetailShell variant="flush">
        <div>body</div>
      </DetailShell>
    );
    const { container: flat } = render(
      <DetailShell variant="flat">
        <div>body</div>
      </DetailShell>
    );
    const flushRoot = flush.firstElementChild!;
    const flatRoot = flat.firstElementChild!;
    expect(flushRoot.className).toContain('mt-0');
    expect(flushRoot.className).toContain('gap-1');
    expect(flatRoot.className).toContain('mt-0.5');
    expect(flatRoot.className).toContain('gap-1.5');
  });
});
