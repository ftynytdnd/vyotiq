import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CapturePickerPanel } from '@renderer/components/composer/capture/CapturePickerPanel.js';

describe('CapturePickerPanel', () => {
  it('keeps app window clickable while thumbnails are loading', () => {
    const onCaptureAppWindow = vi.fn();
    render(
      <CapturePickerPanel
        loading={false}
        showSkeleton={false}
        loadingThumbnails
        capturing={false}
        capturingRowId={null}
        sources={[{ id: 'screen:0:0', name: 'Display 1' }]}
        activeNavId="app-window"
        onActiveNavIdChange={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        onCaptureAppWindow={onCaptureAppWindow}
        onCaptureSource={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('menuitem', { name: /This app window/i }));
    expect(onCaptureAppWindow).toHaveBeenCalledTimes(1);
  });

  it('shows search when many windows are listed', () => {
    const windows = Array.from({ length: 9 }, (_, i) => ({
      id: `window:${i}:0`,
      name: `Window ${i}`
    }));
    render(
      <CapturePickerPanel
        loading={false}
        showSkeleton={false}
        loadingThumbnails={false}
        capturing={false}
        capturingRowId={null}
        sources={windows}
        activeNavId="app-window"
        onActiveNavIdChange={vi.fn()}
        query=""
        onQueryChange={vi.fn()}
        onCaptureAppWindow={vi.fn()}
        onCaptureSource={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Filter capture sources')).toBeInTheDocument();
  });

  it('moves active row with arrow keys', () => {
    const onActiveNavIdChange = vi.fn();
    const { container } = render(
      <CapturePickerPanel
        loading={false}
        showSkeleton={false}
        loadingThumbnails={false}
        capturing={false}
        capturingRowId={null}
        sources={[
          { id: 'screen:0:0', name: 'Display 1' },
          { id: 'window:1:0', name: 'Chrome' }
        ]}
        activeNavId="app-window"
        onActiveNavIdChange={onActiveNavIdChange}
        query=""
        onQueryChange={vi.fn()}
        onCaptureAppWindow={vi.fn()}
        onCaptureSource={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const panel = container.querySelector('.vx-capture-picker-panel');
    expect(panel).not.toBeNull();
    fireEvent.keyDown(panel!, { key: 'ArrowDown' });
    expect(onActiveNavIdChange).toHaveBeenCalledWith('screen:screen:0:0');
  });
});
