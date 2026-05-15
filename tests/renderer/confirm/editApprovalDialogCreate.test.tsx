/**
 * Strict-approvals modal — `create` branch consistency.
 *
 * The timeline `EditInvocation` settled-create branch and the
 * pending-changes panel's `create` branch both render a created
 * file's body as an all-`+` hunk via `EditDiffView` + the shared
 * `synthesizeCreateHunks`. Pre-fix `EditApprovalDialog` used
 * `CodeBlock tone="muted"` here, so the SAME create operation
 * read three different ways across the three surfaces (the diff
 * card in the timeline + pending panel, but a muted plain-text
 * wall in the approval dialog). Audit fix May 2026 routes the
 * dialog through `EditDiffView` too — this test pins that
 * contract so the modal can't drift back to the muted variant.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EditApprovalDialog } from '@renderer/components/confirm/EditApprovalDialog';
import type { EditApprovalPayload } from '@shared/types/ipc';

// `Modal` renders into a `createPortal(document.body)` target, so
// the dialog DOM lives on `document.body` rather than the wrapper
// `container` returned by `render`. Every assertion below queries
// the body so the portal subtree is reached. `cleanup()` between
// tests removes the portal-rendered nodes (RTL's default cleanup
// already does this for portaled content; the explicit afterEach
// is documentation more than need).
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

describe('EditApprovalDialog — create branch routes through EditDiffView', () => {
  it('renders the new file body inside an authoritative diff container', () => {
    render(
      <EditApprovalDialog
        open
        payload={makePayload()}
        queuedBehind={0}
        onApprove={() => { }}
        onApproveAll={() => { }}
        onDeny={() => { }}
      />
    );
    // The shared `EditDiffView` stamps `data-variant` on its
    // outer container. Mounting under the `'create'` branch must
    // produce the `authoritative` variant (matches the timeline's
    // settled-create branch + the pending-changes panel) — NOT a
    // bare `CodeBlock` wrapper, which is what the pre-fix path
    // rendered for muted plain-text bodies.
    const diff = document.body.querySelector('[data-variant="authoritative"]');
    expect(diff).not.toBeNull();
    // Every line of the new body is present with the `+` marker.
    // The marker lives inside `<span class="mr-1 select-none">+</span>`
    // immediately adjacent to the line text in `EditDiffView`.
    const text = document.body.textContent ?? '';
    expect(text).toContain('# Hello');
    expect(text).toContain('second line');
    expect(text).toContain('third line');
    // Three `+` markers — one per content line. We assert at
    // least three so trailing-newline fixtures stay non-flaky
    // (`synthesizeCreateHunks` splits on `\n`, a trailing
    // newline produces a trailing empty `+` line which we don't
    // need to pin here).
    const plusMarkers = diff!.querySelectorAll('.select-none');
    const plusCount = Array.from(plusMarkers).filter(
      (el) => (el.textContent ?? '').trim() === '+'
    ).length;
    expect(plusCount).toBeGreaterThanOrEqual(3);
  });

  it('mounts EditDiffView even when the body is empty (single empty `+` line)', () => {
    // Defensive: zero-byte file creates still render through
    // `EditDiffView` (`synthesizeCreateHunks('')` produces a
    // single empty `+` line). Pre-fix this surfaced as a blank
    // muted block; post-fix it surfaces as one empty diff row,
    // matching the timeline + pending-changes panel behaviour.
    render(
      <EditApprovalDialog
        open
        payload={makePayload({ postBody: '', additions: 0, deletions: 0 })}
        queuedBehind={0}
        onApprove={() => { }}
        onApproveAll={() => { }}
        onDeny={() => { }}
      />
    );
    expect(document.body.querySelector('[data-variant="authoritative"]')).not.toBeNull();
  });

  it('renders the new body with the success-tinted diff lines, not muted plain text', () => {
    // Regression guard against the pre-fix shape: a `CodeBlock`
    // with `tone="muted"` rendered the new file body as a wall
    // of muted plain text. The shared `EditDiffView` produces a
    // diff card with green `+`-tinted lines instead, so a
    // post-fix DOM tree must carry the `text-success` token on
    // at least one body row.
    render(
      <EditApprovalDialog
        open
        payload={makePayload()}
        queuedBehind={0}
        onApprove={() => { }}
        onApproveAll={() => { }}
        onDeny={() => { }}
      />
    );
    const diff = document.body.querySelector('[data-variant="authoritative"]');
    expect(diff).not.toBeNull();
    const lines = Array.from(diff!.querySelectorAll('div'));
    const hasSuccessTinted = lines.some((el) =>
      (el.className ?? '').toString().includes('text-success')
    );
    expect(hasSuccessTinted).toBe(true);
  });
});
