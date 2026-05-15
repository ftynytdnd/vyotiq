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
 */

import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Menu } from './Menu.js';
import { FileMenu, type FileMenuActions } from './menus/FileMenu.js';
import { EditMenu } from './menus/EditMenu.js';
import { ViewMenu } from './menus/ViewMenu.js';

type Which = 'file' | 'edit' | 'view' | null;

interface MenuBarProps {
  fileActions: FileMenuActions;
}

const ORDER: ReadonlyArray<Exclude<Which, null>> = ['file', 'edit', 'view'];

export function MenuBar({ fileActions }: MenuBarProps) {
  const [open, setOpen] = useState<Which>(null);
  const [focused, setFocused] = useState<Exclude<Which, null>>('file');
  const close = () => setOpen(null);
  const handleHover = (which: Exclude<Which, null>) => {
    // Only auto-switch when SOMETHING is already open — the first click
    // must be intentional.
    if (open !== null && open !== which) setOpen(which);
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
          if (open !== null) setOpen(next);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = ORDER[(idx - 1 + ORDER.length) % ORDER.length]!;
          focusAt(next);
          if (open !== null) setOpen(next);
        } else if (e.key === 'Home') {
          e.preventDefault();
          focusAt(ORDER[0]!);
          if (open !== null) setOpen(ORDER[0]!);
        } else if (e.key === 'End') {
          e.preventDefault();
          focusAt(ORDER[ORDER.length - 1]!);
          if (open !== null) setOpen(ORDER[ORDER.length - 1]!);
        } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          // Pressing Down / Enter / Space on a closed label opens it; the
          // panel itself owns inner navigation from there.
          if (open !== which) {
            e.preventDefault();
            setOpen(which);
          }
        } else if (e.key === 'Escape') {
          if (open !== null) {
            e.preventDefault();
            close();
          }
        }
      };

  return (
    <div role="menubar" aria-label="Application" className="flex items-stretch gap-0.5">
      <Menu
        ref={refs.file}
        label="File"
        open={open === 'file'}
        tabIndex={focused === 'file' ? 0 : -1}
        onLabelKeyDown={handleKeyDown('file')}
        onOpen={() => {
          setFocused('file');
          setOpen(open === 'file' ? null : 'file');
        }}
        onHover={() => handleHover('file')}
        onClose={close}
      >
        <FileMenu actions={fileActions} onAfterAction={close} />
      </Menu>
      <Menu
        ref={refs.edit}
        label="Edit"
        open={open === 'edit'}
        tabIndex={focused === 'edit' ? 0 : -1}
        onLabelKeyDown={handleKeyDown('edit')}
        onOpen={() => {
          setFocused('edit');
          setOpen(open === 'edit' ? null : 'edit');
        }}
        onHover={() => handleHover('edit')}
        onClose={close}
      >
        <EditMenu onAfterAction={close} />
      </Menu>
      <Menu
        ref={refs.view}
        label="View"
        open={open === 'view'}
        tabIndex={focused === 'view' ? 0 : -1}
        onLabelKeyDown={handleKeyDown('view')}
        onOpen={() => {
          setFocused('view');
          setOpen(open === 'view' ? null : 'view');
        }}
        onHover={() => handleHover('view')}
        onClose={close}
      >
        <ViewMenu onAfterAction={close} />
      </Menu>
    </div>
  );
}
