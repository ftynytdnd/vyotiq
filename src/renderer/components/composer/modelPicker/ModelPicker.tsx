/**
 * ModelPicker — host component. Owns the trigger pill and delegates the
 * popover panel to the portal-based `Popover` primitive so the panel
 * escapes the composer's `overflow:hidden` clip.
 */

import { useEffect, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { ModelPickerTrigger } from './ModelPickerTrigger.js';
import { ModelPickerPanel } from './ModelPickerPanel.js';
import { Popover } from '../../ui/Popover.js';
import { useUiStore } from '../../../store/useUiStore.js';
import { DOCK_STRIP_WIDTH } from '../../dock/dockShared.js';
import { useModelPickerCollisionPadding } from './useModelPickerCollisionPadding.js';
import { useProviderAccountPollSource } from '../../../lib/useProviderAccountPollSource.js';
import { PANEL_IDS } from '@shared/panels/panelWidths.js';

interface ModelPickerProps {
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  onOpenProviders: () => void;
  /** Empty-chat landing — anchor to composer shell, auto-flip above/below. */
  landing?: boolean;
  /** Composer shell — used as popover anchor on landing. */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function ModelPicker({
  value,
  onChange,
  onOpenProviders,
  landing = false,
  anchorRef
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const dockWidth = useUiStore((s) => s.dockWidth);
  const collisionPadding = useModelPickerCollisionPadding();

  useProviderAccountPollSource('model-picker', open);

  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let ticks = 0;
    const MAX_TICKS = 20;
    const tick = () => {
      ticks += 1;
      setRevision((r) => r + 1);
      if (ticks < MAX_TICKS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockExpanded, dockWidth, DOCK_STRIP_WIDTH, open, landing]);

  return (
    <>
      <ModelPickerTrigger
        ref={triggerRef}
        value={value}
        open={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        anchorRef={anchorRef}
        align={anchorRef ? 'fit' : 'start'}
        preferSide={landing ? 'auto' : 'top'}
        anchorStrict={!!anchorRef}
        collisionPadding={collisionPadding}
        revision={revision}
        fitMaxWidth={640}
        widthMode="panel"
        panelId={PANEL_IDS.MODEL_PICKER}
      >
        <ModelPickerPanel
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          onOpenProviders={onOpenProviders}
        />
      </Popover>
    </>
  );
}
