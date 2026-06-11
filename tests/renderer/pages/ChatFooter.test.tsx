import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatFooter } from '@renderer/pages/ChatFooter';

describe('ChatFooter', () => {
  it('centers the composer column when centered is true', () => {
    render(
      <ChatFooter
        centered
        landing
        contentWidth="max-w-3xl"
        model={null}
        onModelChange={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(document.querySelector('[data-chat-footer-centered]')).toBeTruthy();
    expect(document.querySelector('.vyotiq-chat-landing-enter')).toBeTruthy();
    expect(document.querySelector('.vx-composer-shell--landing')).toBeTruthy();
  });

  it('pins the composer to the bottom when centered is false', () => {
    render(
      <ChatFooter
        contentWidth="max-w-3xl"
        model={null}
        onModelChange={() => undefined}
        onOpenProviders={() => undefined}
      />
    );

    expect(document.querySelector('[data-chat-footer-centered]')).toBeNull();
    expect(document.querySelector('.vyotiq-chat-landing-enter')).toBeNull();
    expect(document.querySelector('.vx-composer-shell--landing')).toBeNull();
  });

  it('plays dock handoff animation when dockingFromCenter is true', () => {
    render(
      <ChatFooter
        contentWidth="max-w-3xl"
        model={null}
        onModelChange={() => undefined}
        onOpenProviders={() => undefined}
        dockingFromCenter
      />
    );

    expect(document.querySelector('.vyotiq-chat-dock-enter')).toBeTruthy();
  });

  it('renders setup lead above the composer when provided', () => {
    render(
      <ChatFooter
        centered
        contentWidth="max-w-3xl"
        model={null}
        onModelChange={() => undefined}
        onOpenProviders={() => undefined}
        setupLead={<p>Open a workspace to begin</p>}
      />
    );

    expect(screen.getByText('Open a workspace to begin')).toBeTruthy();
  });
});
