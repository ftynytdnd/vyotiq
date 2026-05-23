/**
 * `MenuBar` — the strip of File / Edit / View labels that sits left of the
 * window title in the frameless title bar. Owns "which menu is open" so
 * hovering between adjacent labels feels like a native menu strip.
 *
 * Accessibility:
 *   - Container has `role="menubar"` so AT announces the strip correctly.
 *   - Each label is a `role="menuitem"` button supplied by `Menu`.
 *   - Roving tabindex: exactly one label is `tabIndex=0` (the focused
 *     one, or the first label by default); the rest are `tabIndex=-1`.
 *     Arrow-Left / Arrow-Right cycle focus across labels; Home / End
 *     jump to the first / last; Escape closes any open panel.
 *   - Keyboard-driven opens (`ArrowDown` / `Enter` / `Space`, or
 *     arrow-switching while a panel is already open) propagate
 *     `openSource="keyboard"` to `Menu` so focus advances onto the
 *     first menuitem inside the panel — completing the WAI-ARIA
 *     menubar contract. Mouse-driven opens leave focus on the label.
 */

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Menu, type MenuOpenSource } from './Menu.js';
import { FileMenu, type FileMenuActions } from './menus/FileMenu.js';
import { EditMenu } from './menus/EditMenu.js';
import { ViewMenu, type ViewMenuActions } from './menus/ViewMenu.js';

type Which = 'file' | 'edit' | 'view' | null;

interface MenuBarProps {
  fileActions: FileMenuActions;
  viewActions: ViewMenuActions;
}

const ORDER: ReadonlyArray<Exclude<Which, null>> = ['file', 'edit', 'view'];

export function MenuBar({ fileActions, viewActions }: MenuBarProps) {
  const [open, setOpen] = useState<Which>(null);
  const [focused, setFocused] = useState<Exclude<Which, null>>('file');
  // Latest interaction modality. Tracked separately from `open` so the
  // child `Menu` knows whether to advance focus into its panel on the
  // next render. Keyed by the *last* open transition: arrow-switching
  // between siblings while a panel is open inherits `'keyboard'`;
  // hover-switching inherits `'mouse'`. Reset on close so a stale
  // value doesn't leak into the next open.
  const [openSource, setOpenSource] = useState<MenuOpenSource>('mouse');
  const close = () => setOpen(null);
  const handleHover = (which: Exclude<Which, null>) => {
    // Only auto-switch when SOMETHING is already open — the first click
    // must be intentional.
    if (open !== null && open !== which) {
      setOpenSource('mouse');
      setOpen(which);
    }
  };

  const refs = {
    file: useRef<HTMLButtonElement>(null),
    edit: useRef<HTMLButtonElement>(null),
    view: useRef<HTMLButtonElement>(null)
  } as const;

  const focusAt = (next: Exclude<Which, null>) => {
    setFocused(next);
    refs[next].current?.focus();
  };

  const handleKeyDown =
    (which: Exclude<Which, null>) =>
      (e: ReactKeyboardEvent<HTMLButtonElement>) => {
        const idx = ORDER.indexOf(which);
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = ORDER[(idx + 1) % ORDER.length]!;
          focusAt(next);
          if (open !== null) {
            setOpenSource('keyboard');
            setOpen(next);
          }
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = ORDER[(idx - 1 + ORDER.length) % ORDER.length]!;
          focusAt(next);
          if (open !== null) {
            setOpenSource('keyboard');
            setOpen(next);
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          focusAt(ORDER[0]!);
          if (open !== null) {
            setOpenSource('keyboard');
            setOpen(ORDER[0]!);
          }
        } else if (e.key === 'End') {
          e.preventDefault();
          focusAt(ORDER[ORDER.length - 1]!);
          if (open !== null) {
            setOpenSource('keyboard');
            setOpen(ORDER[ORDER.length - 1]!);
          }
        } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          // Pressing Down / Enter / Space on a closed label opens it
          // and tags the open as keyboard-driven so `Menu` advances
          // focus into the panel. The panel itself owns inner
          // navigation from there.
          if (open !== which) {
            e.preventDefault();
            setOpenSource('keyboard');
            setOpen(which);
          }
        } else if (e.key === 'Escape') {
          if (open !== null) {
            e.preventDefault();
            close();
          }
        }
      };

  // Click-driven open — always mouse modality. Toggling the same panel
  // closed is fine; the next open from any source resets the tag.
  const handleClickOpen = (which: Exclude<Which, null>) => {
    setFocused(which);
    setOpenSource('mouse');
    setOpen(open === which ? null : which);
  };

  return (
    <div role="menubar" aria-label="Application" className="flex items-stretch gap-0.5">
      <Menu
        ref={refs.file}
        label="File"
        open={open === 'file'}
        openSource={openSource}
        tabIndex={focused === 'file' ? 0 : -1}
        onLabelKeyDown={handleKeyDown('file')}
        onOpen={() => handleClickOpen('file')}
        onHover={() => handleHover('file')}
        onClose={close}
      >
        <FileMenu actions={fileActions} onAfterAction={close} />
      </Menu>
      <Menu
        ref={refs.edit}
        label="Edit"
        open={open === 'edit'}
        openSource={openSource}
        tabIndex={focused === 'edit' ? 0 : -1}
        onLabelKeyDown={handleKeyDown('edit')}
        onOpen={() => handleClickOpen('edit')}
        onHover={() => handleHover('edit')}
        onClose={close}
      >
        <EditMenu onAfterAction={close} />
      </Menu>
      <Menu
        ref={refs.view}
        label="View"
        open={open === 'view'}
        openSource={openSource}
        tabIndex={focused === 'view' ? 0 : -1}
        onLabelKeyDown={handleKeyDown('view')}
        onOpen={() => handleClickOpen('view')}
        onHover={() => handleHover('view')}
        onClose={close}
      >
        <ViewMenu actions={viewActions} onAfterAction={close} />
      </Menu>
    </div>
  );
}
