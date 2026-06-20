import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MentionPicker } from '@renderer/components/composer/mention/MentionPicker';
import type {
  MentionPickerGroup,
  MentionPickerRow
} from '@renderer/components/composer/mention/useMentionPicker';

const fileRow: MentionPickerRow = {
  id: 'file:src/main/app.ts',
  kind: 'workspace-file',
  label: 'src/main/app.ts',
  path: 'src/main/app.ts',
  depth: 1,
  selectable: true
};

const folderRow: MentionPickerRow = {
  id: 'folder:src',
  kind: 'workspace-folder',
  label: 'src',
  path: 'src',
  depth: 0,
  isDir: true,
  isExpanded: true,
  selectable: false
};

const baseGroups: MentionPickerGroup[] = [
  {
    kind: 'workspace',
    label: 'Workspace',
    rows: [folderRow, fileRow]
  },
  {
    kind: 'symbol',
    label: 'Symbols',
    rows: [],
    emptyHint: 'Type 2+ characters to search symbols'
  },
  {
    kind: 'conversation',
    label: 'Chats',
    rows: [
      {
        id: 'conversation:abc',
        kind: 'conversation',
        label: 'hi',
        conversationId: 'abc12345',
        hint: 'abc12345',
        selectable: true
      }
    ]
  }
];

const flatRows: MentionPickerRow[] = [folderRow, fileRow, baseGroups[2]!.rows[0]!];

describe('MentionPicker', () => {
  it('renders workspace tree with folders and categorized sections', () => {
    render(
      <MentionPicker
        open
        query=""
        groups={baseGroups}
        rows={flatRows}
        activeRow={folderRow}
        loading={false}
        activeIndex={0}
        onActiveIndexChange={vi.fn()}
        onPick={vi.fn()}
        onToggleFolder={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Workspace · 1/)).toBeTruthy();
    expect(screen.getByText('Symbols')).toBeTruthy();
    expect(screen.getByText(/Chats · 1/)).toBeTruthy();
    expect(screen.getByText('src')).toBeTruthy();
    expect(screen.getByText('app.ts')).toBeTruthy();
    expect(screen.getByText('Type 2+ characters to search symbols')).toBeTruthy();
  });

  it('calls onToggleFolder when a folder row is clicked', async () => {
    const user = userEvent.setup();
    const onToggleFolder = vi.fn();
    render(
      <MentionPicker
        open
        query=""
        groups={baseGroups}
        rows={flatRows}
        activeRow={folderRow}
        loading={false}
        activeIndex={0}
        onActiveIndexChange={vi.fn()}
        onPick={vi.fn()}
        onToggleFolder={onToggleFolder}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByText('src'));
    expect(onToggleFolder).toHaveBeenCalledWith('src');
  });

  it('calls onPick when a file row is clicked', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <MentionPicker
        open
        query=""
        groups={baseGroups}
        rows={flatRows}
        activeRow={fileRow}
        loading={false}
        activeIndex={1}
        onActiveIndexChange={vi.fn()}
        onPick={onPick}
        onToggleFolder={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('option', { name: /app\.ts/i }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'workspace-file' }));
  });

  it('returns null when closed', () => {
    const { container } = render(
      <MentionPicker
        open={false}
        query=""
        groups={baseGroups}
        rows={flatRows}
        activeRow={null}
        loading={false}
        activeIndex={0}
        onActiveIndexChange={vi.fn()}
        onPick={vi.fn()}
        onToggleFolder={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
