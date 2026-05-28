/**
 * FloatingPanel — responsive width on narrow viewports (§6 smoke).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FloatingPanel } from '@renderer/components/ui/FloatingPanel';

describe('FloatingPanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('560px'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses full-width layout on narrow viewports', () => {
    render(
      <FloatingPanel open onClose={vi.fn()} title="Settings">
        <p>Panel body</p>
      </FloatingPanel>
    );

    const panel = document.querySelector('.vx-floating-panel');
    expect(panel).toBeTruthy();
    expect(panel!.className).toContain('w-full');
    expect(panel!.className).toContain('max-w-none');
    expect(screen.getByText('Panel body')).toBeTruthy();
  });

  it('clamps wide panels with min() width on regular viewports', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    );

    render(
      <FloatingPanel open onClose={vi.fn()} title="Checkpoints" initialWidth={480}>
        <p>Runs list</p>
      </FloatingPanel>
    );

    const panel = document.querySelector('.vx-floating-panel') as HTMLElement;
    await waitFor(() => {
      expect(panel.className).toContain('max-w-[min(720px,92vw)]');
      expect(panel.style.getPropertyValue('--vx-panel-width')).toBe('480px');
    });
  });
});
