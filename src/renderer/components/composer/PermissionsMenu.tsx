import { ShieldCheck, ShieldAlert, ChevronDown, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { chromePillClassName, chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import {
  useSettingsStore,
  selectEffectivePermissions,
  workspaceHasPermissionOverride
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { Popover } from '../ui/Popover.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { Switch } from '../ui/Switch.js';

/**
 * PermissionsMenu — composer toolbar control for the per-workspace
 * Fully Auto Mode toggle. Renders the dropdown body via the
 * portal-based `Popover` primitive so it escapes the composer's
 * `overflow-hidden` clip.
 *
 * Permissions resolve PER-WORKSPACE — toggling here writes a
 * `permissionsByWorkspace[activeWorkspaceId]` override on top of the
 * global `settings.permissions` block. The user's mental model is
 * "I trust this folder" (or not), a property of the workspace itself.
 * The Settings→Permissions tab is where the user adjusts the global
 * default that workspaces inherit.
 */
export function PermissionsMenu() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const activeWorkspaceLabel = useWorkspaceStore(
    (s) => s.list.find((w) => w.id === s.activeId)?.label ?? null
  );
  const settings = useSettingsStore((s) => s.settings);
  const setPermissionsForWorkspace = useSettingsStore(
    (s) => s.setPermissionsForWorkspace
  );
  const clearWorkspacePermissions = useSettingsStore(
    (s) => s.clearWorkspacePermissions
  );
  const setPermissions = useSettingsStore((s) => s.setPermissions);
  const openGlobalPermissions = useSecondaryZoneStore((s) => s.openSettings);

  const perms = selectEffectivePermissions(activeWorkspaceId, settings);
  const hasOverride = workspaceHasPermissionOverride(activeWorkspaceId, settings);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const summary = perms.allowAuto ? 'Auto' : 'Confirm';

  // Toggle handler routes to the per-workspace override when a
  // workspace is active; otherwise it falls through to the global
  // setter (the brief boot window before the renderer has resolved an
  // active workspace). Without the fallback the toggle would silently
  // do nothing during that window.
  const onToggle = (patch: Partial<typeof perms>) => {
    if (activeWorkspaceId) {
      void setPermissionsForWorkspace(activeWorkspaceId, patch);
    } else {
      void setPermissions(patch);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Permissions: ${perms.allowAuto ? 'Fully Auto Mode on' : 'Confirm each gated action'}`}
        className={cn(chromePillClassName(open), 'shrink-0 gap-1 px-1.5 text-meta')}
      >
        {perms.allowAuto ? (
          <ShieldCheck className="h-3 w-3" strokeWidth={2.25} />
        ) : (
          <ShieldAlert className="h-3 w-3" strokeWidth={2.25} />
        )}
        <span>{summary}</span>
        <ChevronDown className="h-2.5 w-2.5 shrink-0" strokeWidth={2.25} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align="start"
      >
        <div className={cn(chromePopoverPanelClassName, 'w-72 p-2')}>
          {/*
            Workspace label — reminds the user that toggles here are
            scoped. Hidden when there is no active workspace (boot
            window) because there's nothing to scope to yet.
          */}
          {activeWorkspaceLabel && (
            <Eyebrow className="mb-1 px-2">
              {activeWorkspaceLabel}
            </Eyebrow>
          )}
          {/*
            Single toggle replaces the legacy three-flag PermissionsMenu
            (writes / bash / web search). When ON, gated tool calls run
            without confirmation; when OFF, each one prompts the user.
          */}
          <Toggle
            label="Trust this workspace (Fully Auto Mode)"
            value={perms.allowAuto}
            onChange={(v) => onToggle({ allowAuto: v })}
          />
          <div className="mt-2 px-2 text-meta text-text-faint">
            {perms.allowAuto
              ? 'Edits, deletes, shell commands, web search, and reports run without asking.'
              : 'Edits, deletes, shell commands, web search, and reports prompt for confirmation.'}
          </div>
          <div className="mt-2 border-t border-border-subtle/40 px-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openGlobalPermissions('permissions');
              }}
              className="text-row text-text-secondary transition-colors duration-150 hover:text-text-primary"
            >
              Open global permissions settings…
            </button>
          </div>
          {/*
            "Reset to global" — only surfaces when the active workspace
            has any override. Clears the per-workspace entry; the next
            send falls through to the global `permissions` block.
          */}
          {hasOverride && activeWorkspaceId && (
            <div className="mt-2 border-t border-border-subtle/40 pt-2">
              <button
                type="button"
                onClick={() => void clearWorkspacePermissions(activeWorkspaceId)}
                className="flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-row text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.25} />
                <span>Reset to global default</span>
              </button>
            </div>
          )}
        </div>
      </Popover>
    </>
  );
}

function Toggle({
  label,
  value,
  onChange
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  // `Switch` in inline-row mode renders the entire row as a single
  // `<button role="switch">` — label on the left, pill on the right,
  // hover-affordance on the whole surface. That matches the legacy
  // hand-rolled control byte-for-byte while centralizing the
  // visual + a11y semantics inside the shared primitive.
  return <Switch size="sm" label={label} value={value} onChange={onChange} />;
}
