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
      expect(panel.style.getPropertyValue('--vx-panel-width')).toBe('480px');
    });
  });

  it('persists width when widthKey is set', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    );

    const setMock = vi.fn(async () => ({}));
    const prevVyotiq = window.vyotiq;
    window.vyotiq = {
      ...prevVyotiq,
      settings: { ...prevVyotiq.settings, set: setMock }
    };

    render(
      <FloatingPanel open onClose={vi.fn()} title="Memory" widthKey="memory-panel">
        <p>Memory body</p>
      </FloatingPanel>
    );

    const panel = document.querySelector('.vx-floating-panel') as HTMLElement;
    expect(panel.getAttribute('data-panel-width-key')).toBe('memory-panel');

    const handle = panel.querySelector('[aria-hidden]') as HTMLElement;
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 360, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    await waitFor(() => {
      expect(setMock).toHaveBeenCalled();
    });

    window.vyotiq = prevVyotiq;
  });
});
