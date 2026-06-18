/**
 * Follow-up tray — queued + steering sections.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FollowUpTrayHost } from '@renderer/components/composer/followUps/FollowUpTray.js';
import type { FollowUpMessage } from '@shared/types/followUp.js';

const baseItem = (overrides: Partial<FollowUpMessage>): FollowUpMessage => ({
  id: 'fu-1',
  kind: 'queue',
  prompt: 'Fix the tests',
  selection: { providerId: 'p1', modelId: 'm1' },
  queuedAt: Date.now(),
  source: 'composer',
  ...overrides
});

describe('FollowUpTrayHost', () => {
  it('renders queued and steering sections with actions', async () => {
    const user = userEvent.setup();
    const onEditQueued = vi.fn();
    const onRemove = vi.fn();
    const onSendNow = vi.fn();

    render(
      <FollowUpTrayHost
        visible
        isRunActive
        steering={[baseItem({ id: 's1', kind: 'steering', prompt: 'After stream' })]}
        queued={[baseItem({ id: 'q1', kind: 'queue', prompt: 'After finish' })]}
        onEditQueued={onEditQueued}
        onRemove={onRemove}
        onSendNow={onSendNow}
      />
    );

    expect(screen.getByText('1 Queued')).toBeInTheDocument();
    expect(screen.getByText('Send follow-up')).toBeInTheDocument();
    expect(screen.getByText('After finish')).toBeInTheDocument();
    expect(screen.getByText('After stream')).toBeInTheDocument();
    expect(screen.getAllByText('composer')).toHaveLength(2);
    expect(screen.getAllByText('m1')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Send now' }));
    expect(onSendNow).toHaveBeenCalledWith('q1');

    await user.click(screen.getByRole('button', { name: 'Edit queued follow-up' }));
    expect(onEditQueued).toHaveBeenCalled();
  });

  it('renders attachment cards for queued follow-ups with images', () => {
    render(
      <FollowUpTrayHost
        visible
        isRunActive
        steering={[]}
        queued={[
          baseItem({
            id: 'q-img',
            prompt: 'Check screenshot',
            attachmentMeta: [
              {
                id: 'att-1',
                name: 'shot.png',
                mimeType: 'image/png',
                workspacePath: 'shot.png'
              }
            ]
          })
        ]}
        onEditQueued={vi.fn()}
        onRemove={vi.fn()}
        onSendNow={vi.fn()}
      />
    );
    expect(screen.getByTitle('shot.png')).toBeInTheDocument();
  });

  it('shows stale steering badge when run is not active', () => {
    render(
      <FollowUpTrayHost
        visible
        isRunActive={false}
        steering={[baseItem({ id: 's1', kind: 'steering', prompt: 'Stale steer' })]}
        queued={[]}
        onEditQueued={vi.fn()}
        onRemove={vi.fn()}
        onSendNow={vi.fn()}
      />
    );

    expect(screen.getByText('prior run')).toBeInTheDocument();
  });

  it('renders nothing when visible but empty', () => {
    const { queryByTestId } = render(
      <FollowUpTrayHost
        visible
        isRunActive
        steering={[]}
        queued={[]}
        onEditQueued={vi.fn()}
        onRemove={vi.fn()}
        onSendNow={vi.fn()}
      />
    );

    expect(queryByTestId('follow-up-tray')).toBeNull();
  });

  it('hides when not visible', () => {
    const { queryByTestId } = render(
      <FollowUpTrayHost
        visible={false}
        isRunActive
        steering={[]}
        queued={[baseItem({})]}
        onEditQueued={vi.fn()}
        onRemove={vi.fn()}
        onSendNow={vi.fn()}
      />
    );
    expect(queryByTestId('follow-up-tray')).toBeNull();
  });
});
