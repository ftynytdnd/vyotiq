import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MentionComposer } from '@renderer/components/composer/mention/MentionComposer';

describe('MentionComposer prop↔DOM sync', () => {
  it('clears the contenteditable when value is cleared externally', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MentionComposer
        value="First, Analyze the entire codebase."
        onChange={onChange}
      />
    );
    const editor = document.querySelector('[contenteditable="true"]') as HTMLDivElement;
    expect(editor.textContent).toContain('Analyze');

    rerender(<MentionComposer value="" onChange={onChange} />);
    expect(editor.textContent).toBe('');
  });

  it('renders a placeholder overlay aligned with the editor typography', () => {
    const onChange = vi.fn();
    const hint = '@ to mention files, or describe your task…';
    const { container } = render(
      <MentionComposer value="" onChange={onChange} placeholder={hint} />
    );
    const overlay = container.querySelector('.vx-mention-composer-placeholder');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toBe(hint);
  });
});
