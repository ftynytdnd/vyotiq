/**
 * Composer landing shell and placeholder integration.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Composer } from '@renderer/components/composer/Composer';
import { COMPOSER_LANDING_PLACEHOLDER } from '@renderer/components/composer/composerPlaceholder';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: 'conv-1',
    events: [],
    draft: '',
    isProcessing: false
  });
});

describe('Composer landing', () => {
  it('uses landing placeholder when landing is true and the field is empty', () => {
    render(
      <Composer
        landing
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(screen.getByText(COMPOSER_LANDING_PLACEHOLDER)).toBeInTheDocument();
  });

  it('shows synced draft content instead of placeholder when draft exists', () => {
    useChatStore.setState({ draft: 'Saved draft text' });

    render(
      <Composer
        landing
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(screen.getByRole('textbox')).toHaveTextContent('Saved draft text');
    expect(screen.queryByText(COMPOSER_LANDING_PLACEHOLDER)).toBeNull();
  });

  it('applies landing shell styling', () => {
    const { container } = render(
      <Composer
        landing
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(container.querySelector('.vx-composer-shell--landing')).toBeTruthy();
  });
});
