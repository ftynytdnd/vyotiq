import { afterEach, describe, expect, it } from 'vitest';
import { focusComposer } from '@renderer/lib/focusComposer.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusComposer', () => {
  it('focuses the composer editor and places the caret at the end', () => {
    const editor = document.createElement('div');
    editor.setAttribute('data-composer-editor', '');
    editor.setAttribute('contenteditable', 'true');
    editor.textContent = 'hello';
    document.body.appendChild(editor);

    expect(focusComposer()).toBe(true);
    expect(document.activeElement).toBe(editor);
  });

  it('returns false when no composer editor is mounted', () => {
    expect(focusComposer()).toBe(false);
  });
});
