import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusComposer } from '@renderer/lib/focusComposer.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('focusComposer', () => {
  it('focuses the composer editor and places the caret at the end', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });

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
