import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PromptAttachmentCards } from '@renderer/components/composer/PromptAttachmentCards';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    attachments: {
      fileUrl: vi.fn(async () => 'file://thumb')
    }
  }
}));

vi.mock('@renderer/store/useWorkspaceStore.js', () => ({
  useWorkspaceStore: (selector: (s: { activeId: string }) => unknown) =>
    selector({ activeId: 'ws-1' })
}));

vi.mock('@renderer/lib/openAttachment.js', () => ({
  attachmentPreviewPathInput: () => 'captures/shot.png',
  openAttachment: vi.fn()
}));

describe('PromptAttachmentCards', () => {
  it('renders image thumbnail from filename when mime type is missing', async () => {
    render(
      <PromptAttachmentCards
        editable
        items={[
          {
            id: 'a1',
            name: 'screenshot.png',
            workspacePath: 'captures/screenshot.png'
          }
        ]}
      />
    );

    const card = screen.getByRole('button', { name: /screenshot\.png/i }).closest('.vx-attachment-card');
    expect(card).toHaveClass('vx-attachment-card--image-named');
    await waitFor(() => {
      expect(document.querySelector('img.vx-attachment-card__thumb')).toBeInTheDocument();
    });
  });

  it('renders compact chips for composer variant', () => {
    const { container } = render(
      <PromptAttachmentCards
        editable
        variant="chip"
        items={[
          {
            id: 'v1',
            name: 'Screen Recording 2026-06-19.mp4',
            mimeType: 'video/mp4',
            mediaKind: 'video',
            workspacePath: 'captures/recording.mp4'
          }
        ]}
      />
    );

    expect(container.querySelector('.vx-attachment-chip')).not.toBeNull();
    expect(container.querySelector('.vx-attachment-card')).toBeNull();
    expect(screen.getByRole('button', { name: /Screen Recording/i })).toBeInTheDocument();
  });
});
