/**
 * PreviewCanvas — attachment preview tab and empty state.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviewCanvas } from '@renderer/components/workbench/PreviewCanvas';
import { useAttachmentPreviewStore } from '@renderer/store/useAttachmentPreviewStore';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    attachments: {
      fileUrl: vi.fn(async () => 'file:///tmp/preview.png')
    }
  }
}));

describe('PreviewCanvas', () => {
  beforeEach(() => {
    useAttachmentPreviewStore.setState({ attachment: null });
  });

  it('shows marketing empty state when no attachment is active', () => {
    const { container } = render(<PreviewCanvas />);
    expect(container.querySelector('.vx-preview-empty')).toBeTruthy();
    expect(screen.getByText(/^Preview$/)).toBeTruthy();
  });

  it('renders PreviewZone when an attachment is open', () => {
    useAttachmentPreviewStore.setState({
      attachment: {
        name: 'shot.png',
        storedPath: 'ws/shot.png',
        mimeType: 'image/png'
      }
    });
    const { container } = render(<PreviewCanvas />);
    expect(container.querySelector('.vx-preview-empty')).toBeNull();
    expect(container.querySelector('.vx-preview-zone')).toBeTruthy();
  });
});
