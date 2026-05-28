/**
 * Strict-approvals modal — `create` branch consistency.
 *
 * The timeline `EditInvocation` settled-create branch and the
 * pending-changes panel's `create` branch both render a created
 * file's body as an all-`+` hunk via `EditDiffView` + the shared
 * `synthesizeCreateHunks`. Pre-fix `EditApprovalDialog` used
 * `CodeBlock tone="muted"` here, so the SAME create operation
 * read three different ways across the three surfaces.
 *
 * The dialog now opens with a compact 3-line preview that
 * expands to the full `UnifiedDiffPanel` on demand (per
 * `dialog-ux-redesign.md`). These tests click "Show full diff"
 * before asserting on the authoritative diff container so they
 * reflect the post-redesign contract.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditApprovalDialog } from '@renderer/components/confirm/EditApprovalDialog';
import type { EditApprovalPayload } from '@shared/types/ipc';

afterEach(() => cleanup());

const NEW_FILE_BODY = ['# Hello', 'second line', 'third line'].join('\n');

function makePayload(overrides: Partial<EditApprovalPayload> = {}): EditApprovalPayload {
  return {
    kind: 'edit-approval',
    filePath: 'docs/intro.md',
    operation: 'create',
    postBody: NEW_FILE_BODY,
    additions: 3,
    deletions: 0,
    runId: 'run-1',
    ...overrides
  };
}

async function expandFullDiff() {
  const expand = screen.getByRole('button', { name: /show full diff/i });
  await userEvent.click(expand);
}

describe('EditApprovalDialog — create branch routes through EditDiffView', () => {
  it('renders the new file body inside an authoritative diff container after expand', async () => {
    render(
      <EditApprovalDialog
        open
        payload={makePayload()}
        queuePosition={1}
        queueTotal={1}
        queuedBehind={0}
        onApprove={() => { }}
        onApproveAll={() => { }}
        onDeny={() => { }}
      />
    );
    await expandFullDiff();

    const diff = document.body.querySelector('[data-variant="authoritative"]');
    expect(diff).not.toBeNull();
    const text = document.body.textContent ?? '';
    expect(text).toContain('# Hello');
    expect(text).toContain('second line');
    expect(text).toContain('third line');
    const plusMarkers = diff!.querySelectorAll('.select-none');
    const plusCount = Array.from(plusMarkers).filter(
      (el) => (el.textContent ?? '').trim() === '+'
    ).length;
    expect(plusCount).toBeGreaterThanOrEqual(3);
  });

  it('mounts EditDiffView even when the body is empty after expand', async () => {
    render(
      <EditApprovalDialog
        open
        payload={makePayload({ postBody: '', additions: 0, deletions: 0 })}
        queuePosition={1}
        queueTotal={1}
        queuedBehind={0}
        onApprove={() => { }}
        onApproveAll={() => { }}
        onDeny={() => { }}
      />
    );
    await expandFullDiff();
    expect(document.body.querySelector('[data-variant="authoritative"]')).not.toBeNull();
  });

  it('renders the new body with the success-tinted diff lines after expand', async () => {
    render(
      <EditApprovalDialog
        open
        payload={makePayload()}
        queuePosition={1}
        queueTotal={1}
        queuedBehind={0}
        onApprove={() => { }}
        onApproveAll={() => { }}
        onDeny={() => { }}
      />
    );
    await expandFullDiff();
    const diff = document.body.querySelector('[data-variant="authoritative"]');
    expect(diff).not.toBeNull();
    const lines = Array.from(diff!.querySelectorAll('div'));
    const hasSuccessTinted = lines.some((el) =>
      (el.className ?? '').toString().includes('text-success')
    );
    expect(hasSuccessTinted).toBe(true);
  });

  it('opens compact: shows a 3-line preview and a "Show full diff" expander', () => {
    render(
      <EditApprovalDialog
        open
        payload={makePayload()}
        queuePosition={1}
        queueTotal={1}
        queuedBehind={0}
        onApprove={() => { }}
        onApproveAll={() => { }}
        onDeny={() => { }}
      />
    );
    // No authoritative diff yet — compact preview by default.
    expect(document.body.querySelector('[data-variant="authoritative"]')).toBeNull();
    expect(screen.getByRole('button', { name: /show full diff/i })).toBeTruthy();
    // Compact preview shows the new body lines as `+` rows.
    const text = document.body.textContent ?? '';
    expect(text).toContain('# Hello');
  });

  it('shows a queue stepper badge in the header when more approvals are pending', () => {
    render(
      <EditApprovalDialog
        open
        payload={makePayload()}
        queuePosition={1}
        queueTotal={5}
        queuedBehind={4}
        onApprove={() => { }}
        onApproveAll={() => { }}
        onDeny={() => { }}
      />
    );
    expect(screen.getByText(/Approval 1 of 5/)).toBeTruthy();
  });
});
