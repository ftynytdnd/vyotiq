/**
 * MarkdownBody — GFM task-list checkbox override (audit fix A5).
 *
 * remark-gfm renders `- [x] text` / `- [ ] text` as
 * `<li class="task-list-item"><input type="checkbox" disabled> text</li>`.
 * The native browser checkbox reads as a glaring white square on the
 * stealth-dark surface (visible in the audit screenshots inside the
 * assistant's `Current Progress Status` list). The MarkdownBody
 * `input` override swaps the native control for a stealth-dark icon
 * (`<TaskCheckbox>`); the CSS rule under `.vyotiq-md li.task-list-item`
 * suppresses the parent disc.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownBody } from '@renderer/components/timeline/markdown/MarkdownBody';

describe('MarkdownBody — GFM task-list checkbox', () => {
  it('replaces native checkbox with the styled TaskCheckbox icon', () => {
    const { container } = render(
      <MarkdownBody text={'- [x] Done thing\n- [ ] Pending thing'} />
    );
    // The native browser checkbox MUST be gone — that was the
    // audit-screenshot artefact.
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    // Two task-list items render with the override.
    const items = container.querySelectorAll('li.task-list-item');
    expect(items.length).toBe(2);
    // Each item carries a role=img span (the override) instead of
    // the native input.
    const icons = container.querySelectorAll('li.task-list-item span[role="img"]');
    expect(icons.length).toBe(2);
    // First item is checked, second is not.
    expect(icons[0]?.getAttribute('aria-label')).toBe('Completed');
    expect(icons[1]?.getAttribute('aria-label')).toBe('Not completed');
  });

  it('does not affect non-task-list lists', () => {
    const { container } = render(
      <MarkdownBody text={'- regular bullet\n- another'} />
    );
    expect(container.querySelectorAll('li.task-list-item').length).toBe(0);
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    // The standard <li> still renders.
    expect(container.querySelectorAll('li').length).toBe(2);
  });
});
