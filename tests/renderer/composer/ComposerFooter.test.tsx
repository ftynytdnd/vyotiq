import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { ComposerFooter } from '@renderer/components/composer/ComposerFooter';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    isProcessing: false,
    latestOrchestratorRunStatus: undefined,
    runStartedAt: null
  });
});

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

  it('keeps send on the trailing edge via flex layout', () => {
    const { container } = render(
      <ComposerFooter
        attachmentCount={1}
        sendState="ready"
        onSend={() => {}}
        canSend
      />
    );
    const footer = container.querySelector('.vx-composer-footer');
    expect(footer?.className ?? '').toMatch(/\bflex\b/);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('shows live phase label while processing', () => {
    useChatStore.setState({
      isProcessing: true,
      runStartedAt: Date.now() - 5000,
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        id: 'rs1',
        ts: Date.now(),
        phase: 'running-tool',
        label: 'Running tool',
        detail: { toolName: 'read' }
      }
    });
    render(
      <ComposerFooter
        attachmentCount={0}
        sendState="processing"
        onSend={() => {}}
        canSend={false}
      />
    );
    expect(screen.getByText(/Exploring/i)).toBeInTheDocument();
  });
});
