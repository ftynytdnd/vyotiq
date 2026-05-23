/**
 * `MenuBar` keyboard-vs-mouse focus advancement.
 *
 * Regression coverage for the WAI-ARIA menubar contract: when a label
 * is opened via keyboard (`ArrowDown` / `Enter` / `Space`), focus must
 * advance to the first enabled `[role="menuitem"]` inside the panel
 * on the next frame. Mouse-driven opens (`click`) must leave focus on
 * the label so the pointer / focus relationship stays predictable.
 *
 * The discriminator lives in `MenuBar` (`openSource` state, threaded
 * into each child `Menu`) and the focus advance lives in `Menu`'s
 * rAF-delayed effect. This test pins both halves.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuBar } from '@renderer/components/titlebar/menu/MenuBar';
import type { FileMenuActions } from '@renderer/components/titlebar/menu/menus/FileMenu';
import type { ViewMenuActions } from '@renderer/components/titlebar/menu/menus/ViewMenu';

function makeFileActions(): FileMenuActions {
  return {
    newConversation: () => {},
    openWorkspace: () => {},
    setWorkspacePath: () => {},
    openSettings: () => {},
    openCheckpoints: () => {},
    openContextInspector: () => {},
    quit: () => {}
  };
}

function makeViewActions(): ViewMenuActions {
  return {
    openContextInspector: () => {}
  };
}

describe('MenuBar — keyboard vs. mouse focus advancement', () => {
  it('Enter on a closed File label opens and focuses the first menuitem', async () => {
    const user = userEvent.setup();
    render(<MenuBar fileActions={makeFileActions()} viewActions={makeViewActions()} />);

    const fileLabel = screen.getByRole('menuitem', { name: 'File' });
    fileLabel.focus();
    expect(document.activeElement).toBe(fileLabel);

    await user.keyboard('{Enter}');

    // Panel renders synchronously; focus advances on the next frame.
    // The first item in `FileMenu` is `New Conversation`.
    const firstItem = await waitFor(() =>
      screen.getByRole('menuitem', { name: /New Conversation/i })
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(firstItem);
    });
  });

  it('ArrowDown on a closed File label opens and focuses the first menuitem', async () => {
    const user = userEvent.setup();
    render(<MenuBar fileActions={makeFileActions()} viewActions={makeViewActions()} />);

    const fileLabel = screen.getByRole('menuitem', { name: 'File' });
    fileLabel.focus();

    await user.keyboard('{ArrowDown}');

    const firstItem = await waitFor(() =>
      screen.getByRole('menuitem', { name: /New Conversation/i })
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(firstItem);
    });
  });

  it('Space on a closed File label opens and focuses the first menuitem', async () => {
    const user = userEvent.setup();
    render(<MenuBar fileActions={makeFileActions()} viewActions={makeViewActions()} />);

    const fileLabel = screen.getByRole('menuitem', { name: 'File' });
    fileLabel.focus();

    await user.keyboard(' ');

    const firstItem = await waitFor(() =>
      screen.getByRole('menuitem', { name: /New Conversation/i })
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(firstItem);
    });
  });

  it('mouse click on the File label opens the panel WITHOUT advancing focus', async () => {
    const user = userEvent.setup();
    render(<MenuBar fileActions={makeFileActions()} viewActions={makeViewActions()} />);

    const fileLabel = screen.getByRole('menuitem', { name: 'File' });

    // `userEvent.click` simulates a real mouse interaction — the label
    // receives focus as part of the click sequence but our contract
    // requires that focus stays on the label rather than the panel's
    // first menuitem.
    await user.click(fileLabel);

    // Wait until the panel is rendered so we know the open transition
    // has committed — but the rAF that *would* advance focus must not
    // fire for the mouse path.
    const firstItem = await waitFor(() =>
      screen.getByRole('menuitem', { name: /New Conversation/i })
    );

    // Flush an animation frame to give any scheduled focus a chance.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(document.activeElement).toBe(fileLabel);
    expect(document.activeElement).not.toBe(firstItem);
  });

  it('keyboard arrow-switching across siblings carries the keyboard modality', async () => {
    const user = userEvent.setup();
    render(<MenuBar fileActions={makeFileActions()} viewActions={makeViewActions()} />);

    // Open File via keyboard.
    const fileLabel = screen.getByRole('menuitem', { name: 'File' });
    fileLabel.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      screen.getByRole('menuitem', { name: /New Conversation/i })
    );

    // Move keyboard focus back to the File label, then ArrowRight to
    // switch to the Edit panel while a panel is already open. The
    // keyboard modality should propagate so the Edit panel also
    // advances focus to its first menuitem.
    fileLabel.focus();
    await user.keyboard('{ArrowRight}');

    // Edit menu's first row is `Undo` (defined in `EditMenu`).
    const editFirst = await waitFor(() =>
      screen.getByRole('menuitem', { name: /Undo/i })
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(editFirst);
    });
  });
});
