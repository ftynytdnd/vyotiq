/**

 * Shared find-in-surface bar for workbench companions (terminal, browser).

 */



import { FindBarShell } from '../ui/FindBarShell.js';

import { cn } from '../../lib/cn.js';



export interface WorkbenchFindBarProps {

  placeholder: string;

  value: string;

  onChange: (next: string) => void;

  onFind: (forward: boolean) => void;

  onClose: () => void;

  /** Use Geist Mono for terminal find input. */

  mono?: boolean;

  className?: string;

}



export function WorkbenchFindBar({

  placeholder,

  value,

  onChange,

  onFind,

  onClose,

  mono = false,

  className

}: WorkbenchFindBarProps) {

  return (

    <FindBarShell

      placeholder={placeholder}

      value={value}

      onChange={onChange}

      onStep={onFind}

      onClose={onClose}

      autoFocus

      mono={mono}

      navVariant="arrow"

      className={cn(

        'vx-workbench-find flex shrink-0 items-center gap-1 border-b border-border-subtle/20 bg-surface-raised/60 px-2 py-1',

        className

      )}

    />

  );

}

