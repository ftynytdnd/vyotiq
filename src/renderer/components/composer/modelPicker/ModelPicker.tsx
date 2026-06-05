/**
 * ModelPicker — host component. Owns the trigger pill and delegates the
 * popover panel to the portal-based `Popover` primitive so the panel
 * escapes the composer's `overflow:hidden` clip.
 *
 * Outside-click, Escape, and resize/scroll repositioning are handled by
 * `Popover`; this file only owns whether the panel is open and the
 * layout revision (which the popover repositions against).
 */

import { useEffect, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { ModelPickerTrigger } from './ModelPickerTrigger.js';
import { ModelPickerPanel } from './ModelPickerPanel.js';
import { Popover } from '../../ui/Popover.js';
import { useUiStore } from '../../../store/useUiStore.js';
import { DOCK_STRIP_WIDTH } from '../../dock/dockShared.js';

interface ModelPickerProps {
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  /** Opens Settings → providers (empty state CTA in panel). */
  onOpenProviders: () => void;
}

export function ModelPicker({ value, onChange, onOpenProviders }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const dockWidth = useUiStore((s) => s.dockWidth);

  // Bump the popover's `revision` while the dock transition is in
  // flight so the panel re-anchors smoothly.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let ticks = 0;
    const MAX_TICKS = 8;
    const tick = () => {
      ticks += 1;
      setRevision((r) => r + 1);
      if (ticks < MAX_TICKS) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockExpanded, dockWidth, DOCK_STRIP_WIDTH]);

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
        align="end"
        preferSide="top"
        collisionPadding={{ bottom: 56, top: 12 }}
        revision={revision}
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
