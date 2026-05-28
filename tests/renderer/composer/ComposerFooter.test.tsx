import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { ComposerFooter } from '@renderer/components/composer/ComposerFooter';

describe('ComposerFooter attachment counter', () => {
  it('hides N/10 until the first attachment is added', () => {
    render(
      <ComposerFooter
        attachmentCount={0}
        sendState="idle"
        onSend={() => {}}
        canSend={false}
      />
    );
    expect(screen.queryByText(`0/${MAX_CHAT_ATTACHMENTS}`)).toBeNull();
  });

  it('shows N/10 once attachments exist', () => {
    render(
      <ComposerFooter
        attachmentCount={2}
        sendState="ready"
        onSend={() => {}}
        canSend
      />
    );
    expect(screen.getByText(`2/${MAX_CHAT_ATTACHMENTS}`)).toBeInTheDocument();
  });
});
