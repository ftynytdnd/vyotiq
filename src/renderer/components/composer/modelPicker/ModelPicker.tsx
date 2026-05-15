/**
 * ModelPicker — host component. Owns the trigger pill and delegates the
 * popover panel to the portal-based `Popover` primitive so the panel
 * escapes the composer's `overflow:hidden` clip.
 *
 * Outside-click, Escape, and resize/scroll repositioning are handled by
 * `Popover`; this file only owns whether the panel is open and the
 * sidebar-toggle revision (which the popover repositions against).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { ModelPickerTrigger } from './ModelPickerTrigger.js';
import { ModelPickerPanel } from './ModelPickerPanel.js';
import { Popover } from '../../ui/Popover.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { useUiStore } from '../../../store/useUiStore.js';

interface ModelPickerProps {
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  /** Routed to when the trigger is clicked while no enabled provider has any
   *  discovered models. Avoids opening an empty popover. */
  onOpenProviders: () => void;
}

export function ModelPicker({ value, onChange, onOpenProviders }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const providers = useProviderStore((s) => s.providers);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const hasEnabledProvider = useMemo(
    () => providers.some((p) => p.enabled),
    [providers]
  );

  // Bump the popover's `revision` while the sidebar transition is in
  // flight so the panel re-anchors smoothly. The CSS transition is 200 ms
  // (`duration-200`); the Popover also subscribes to scroll/resize via
  // capture, so we only need a small number of re-measures here to cover
  // the layout-only animation window. Fixed 8-frame burst (~130 ms at
  // 60 Hz, padded to 16-20 on slower machines) keeps render churn
  // bounded.
  //
  // Effect deps are `[sidebarOpen]` — opening the popover itself doesn't
  // need a re-anchor burst because `Popover` already runs an immediate
  // measure on mount + listens to scroll/resize. The burst is purely to
  // smooth out the sidebar's width transition while the panel is open.
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
  }, [sidebarOpen]);

  const handleToggle = () => {
    if (!hasEnabledProvider) {
      onOpenProviders();
      return;
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <ModelPickerTrigger ref={triggerRef} value={value} open={open} onClick={handleToggle} />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align="end"
        revision={revision}
      >
        <ModelPickerPanel
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </>
  );
}
