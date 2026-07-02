/**

 * `/` skill slash command picker — uses shared ComposerPicker shell + stacked rows.

 */



import { useEffect, useRef } from 'react';

import { Slash } from 'lucide-react';

import { chromeNoMatchesClassName } from '../../ui/SurfaceShell.js';

import { LoadingHint } from '../../ui/LoadingHint.js';

import { cn } from '../../../lib/cn.js';

import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../lib/shellIcons.js';

import type { SkillSlashPickerRow } from './useSkillSlashPicker.js';

import { scrollMentionRowIntoView } from '../mention/scrollMentionRowIntoView.js';

import { highlightSkillName } from './skillSlashHighlight.js';

import {

  ComposerPickerFoot,

  ComposerPickerHead,

  ComposerPickerShell

} from '../picker/ComposerPickerPanel.js';

import { ComposerPickerHints } from '../picker/ComposerPickerHints.js';

import { ComposerPickerBadge, ComposerPickerRow } from '../picker/ComposerPickerRow.js';



export interface SkillSlashPickerProps {

  open: boolean;

  query: string;

  rows: SkillSlashPickerRow[];

  activeRow: SkillSlashPickerRow | null;

  loading: boolean;

  activeIndex: number;

  scrollFromKeyboardRef?: React.RefObject<boolean>;

  onActiveIndexChange: (index: number) => void;

  onPick: (row: SkillSlashPickerRow) => void;

  onClose: () => void;

}



function skillRowBadges(row: SkillSlashPickerRow) {

  if (row.isBuiltinCommand) {

    return <ComposerPickerBadge tone="command">Command</ComposerPickerBadge>;

  }

  if (row.manualOnly) {

    return <ComposerPickerBadge tone="manual">Manual only</ComposerPickerBadge>;

  }

  return null;

}



export function SkillSlashPicker({

  open,

  query,

  rows,

  activeRow,

  loading,

  activeIndex,

  scrollFromKeyboardRef,

  onActiveIndexChange,

  onPick,

  onClose

}: SkillSlashPickerProps) {

  const listRef = useRef<HTMLDivElement>(null);

  const trimmedQuery = query.trim();



  useEffect(() => {

    if (!open || !activeRow || !scrollFromKeyboardRef?.current) return;

    const el = listRef.current?.querySelector(`[data-composer-picker-row="${activeRow.id}"]`);

    if (el instanceof HTMLElement) {

      scrollMentionRowIntoView(listRef.current, el);

    }

    scrollFromKeyboardRef.current = false;

  }, [activeIndex, activeRow, open, scrollFromKeyboardRef]);



  if (!open) return null;



  const showEmpty = rows.length === 0 && !loading;

  const showLoading = loading && rows.length === 0;

  const headIcon = (

    <Slash

      className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-faint')}

      strokeWidth={SHELL_ROW_ICON_STROKE}

      aria-hidden

    />

  );



  return (

    <ComposerPickerShell

      className="vx-composer-picker-panel--stacked vx-skill-slash-picker"

      listRef={listRef}

      listAriaLabel="Skills"

      listAriaBusy={loading}

      activeDescendantId={activeRow ? `composer-picker-row-${activeRow.id}` : undefined}

      head={

        <ComposerPickerHead

          icon={headIcon}

          title={

            <>

              Skills

              {!loading && rows.length > 0 ? (

                <span className="text-text-faint"> · {rows.length}</span>

              ) : null}

            </>

          }

          subtitle={

            trimmedQuery.length > 0

              ? `Filtering · ${trimmedQuery}`

              : 'Invoke a reusable workflow'

          }

        />

      }

      foot={

        <ComposerPickerFoot>

          <ComposerPickerHints />

        </ComposerPickerFoot>

      }

    >

      {showLoading ? (

        <LoadingHint message="Loading skills…" className="py-6 text-meta" size={12} />

      ) : null}

      {showEmpty ? (

        <p className={cn(chromeNoMatchesClassName, 'px-2 py-2')}>

          No skills match &quot;{query}&quot;

        </p>

      ) : null}

      {rows.length > 0 ? (

        <ul className="flex flex-col gap-0.5 pb-0.5">

          {rows.map((row, index) => (

            <li key={row.id}>

              <ComposerPickerRow

                rowId={row.id}

                layout="stacked"

                active={activeRow?.id === row.id}

                ariaLabel={`/${row.name}. ${row.description}`}

                title={row.description}

                primary={highlightSkillName(row.name, query)}

                description={row.description}

                badges={skillRowBadges(row)}

                onMouseEnter={() => onActiveIndexChange(index)}

                onClick={() => {

                  onPick(row);

                  onClose();

                }}

              />

            </li>

          ))}

        </ul>

      ) : null}

    </ComposerPickerShell>

  );

}


