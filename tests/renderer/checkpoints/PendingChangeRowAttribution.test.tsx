/**
 * PendingChangeRow attribution pills — bash source + sub-agent id.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PendingChange } from '@shared/types/checkpoint';
import { PendingChangeRow } from '@renderer/components/checkpoints/PendingChangeRow';

const base: PendingChange = {
  entryId: 'e-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  filePath: 'src/feature.ts',
  kind: 'modify',
  additions: 2,
  deletions: 1,
  createdAt: 0
};

describe('PendingChangeRow — attribution', () => {
  it('renders nothing extra for orchestrator edits without attribution', () => {
    render(<PendingChangeRow change={base} />);
    expect(screen.queryByText('bash')).toBeNull();
    expect(screen.queryByText('A1')).toBeNull();
  });

  it('shows a bash badge when source is bash', () => {
    render(<PendingChangeRow change={{ ...base, source: 'bash' }} />);
    expect(screen.getByText('bash')).toBeTruthy();
  });

  it('shows the sub-agent id when present', () => {
    render(<PendingChangeRow change={{ ...base, subagentId: 'A1', source: 'edit' }} />);
    expect(screen.getByText('A1')).toBeTruthy();
  });

  it('shows both bash and sub-agent badges together', () => {
    render(
      <PendingChangeRow
        change={{ ...base, source: 'bash', subagentId: 'B2', filePath: 'script.sh' }}
      />
    );
    expect(screen.getByText('bash')).toBeTruthy();
    expect(screen.getByText('B2')).toBeTruthy();
  });
});
