import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MentionComposer } from '@renderer/components/composer/mention/MentionComposer';

vi.mock('@renderer/components/composer/mention/useMentionPicker.js', () => ({
  useMentionPicker: () => ({
    rows: [
      {
        id: 'file:src/a.ts',
        kind: 'workspace-file',
        label: 'src/a.ts',
        path: 'src/a.ts',
        selectable: true
      }
    ],
    selectableRows: [
      {
        id: 'file:src/a.ts',
        kind: 'workspace-file',
        label: 'src/a.ts',
        path: 'src/a.ts',
        selectable: true
      }
    ],
    groups: [{ kind: 'workspace', label: 'Workspace', rows: [] }],
    activeRow: {
      id: 'file:src/a.ts',
      kind: 'workspace-file',
      label: 'src/a.ts',
      path: 'src/a.ts',
      selectable: true
    },
    activeIndex: 0,
    setActiveIndex: vi.fn(),
    moveActive: vi.fn(),
    activateRow: vi.fn(() => 'noop' as const),
    toggleFolder: vi.fn(),
    setFolderExpandedState: vi.fn(),
    loading: false,
    treeTruncated: false,
    scrollFromKeyboardRef: { current: false }
  })
}));

function MentionComposerHarness() {
  const [value, setValue] = useState('');
  return <MentionComposer value={value} onChange={setValue} requestFocus focusSession="t1" />;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MentionComposer Escape', () => {
  it('dismisses the mention picker without removing the @ token text', async () => {
    const user = userEvent.setup();
    render(<MentionComposerHarness />);
    const editor = document.querySelector('[data-composer-editor]') as HTMLDivElement;

    await user.click(editor);
    await user.type(editor, '@src');

    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(editor.textContent).toContain('@src');
  });
});
