/**
 * PendingChangeAttribution — tool source badges on pending rows.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingChangeAttribution } from '@renderer/components/checkpoints/shared/PendingChangeAttribution.js';
import type { PendingChange } from '@shared/types/checkpoint.js';

const baseChange: PendingChange = {
  entryId: 'e-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  filePath: 'src/a.ts',
  kind: 'modify',
  additions: 1,
  deletions: 0,
  createdAt: 1
};

describe('PendingChangeAttribution', () => {
  it('shows bash source badge', () => {
    render(<PendingChangeAttribution change={{ ...baseChange, source: 'bash' }} />);
    expect(screen.getByText('bash')).toBeTruthy();
  });

  it('shows sub-agent id badge', () => {
    render(<PendingChangeAttribution change={{ ...baseChange, subagentId: 'agent-1' }} />);
    expect(screen.getByText('agent-1')).toBeTruthy();
  });

  it('renders nothing when no tool attribution exists', () => {
    const { container } = render(<PendingChangeAttribution change={baseChange} />);
    expect(container).toBeEmptyDOMElement();
  });
});
