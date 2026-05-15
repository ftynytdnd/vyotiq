import { ShieldCheck, ShieldAlert, ChevronDown, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn.js';
import {
  useSettingsStore,
  selectEffectivePermissions,
  workspaceHasPermissionOverride
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { Popover } from '../ui/Popover.js';
import { Eyebrow } from '../ui/Eyebrow.js';

/**
 * PermissionsMenu — composer toolbar control that gates writes / bash /
 * web search. Renders the dropdown body via the portal-based `Popover`
 * primitive so it escapes the composer's `overflow-hidden` clip (the
 * earlier inline `absolute bottom-full` block hid the top toggle rows
 * behind the composer's rounded panel).
 *
 * Permissions resolve PER-WORKSPACE — toggling here writes a
 * `permissionsByWorkspace[activeWorkspaceId]` override on top of the
 * global `settings.permissions` block. The user's mental model is
 * "this folder is sandboxed / safe / unsafe", a property of the
 * workspace itself. The Settings→Permissions tab is where the user
 * adjusts the global default that workspaces inherit.
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

  const perms = selectEffectivePermissions(activeWorkspaceId, settings);
  const hasOverride = workspaceHasPermissionOverride(activeWorkspaceId, settings);
  const allOn = perms.allowFileWrites && perms.allowBash && perms.allowWebSearch;
  const allOff = !perms.allowFileWrites && !perms.allowBash && !perms.allowWebSearch;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const summary = allOn ? 'Full access' : allOff ? 'Locked' : 'Custom';

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
        title={`Permissions: ${summary}`}
        className={cn(
          'app-no-drag inline-flex h-6 shrink-0 items-center gap-1 rounded-inner px-1.5 text-meta',
          'bg-surface-overlay text-text-muted transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary',
          open && 'bg-surface-hover text-text-primary'
        )}
      >
        {allOff ? (
          <ShieldAlert className="h-3 w-3" strokeWidth={2.25} />
        ) : (
          <ShieldCheck className="h-3 w-3" strokeWidth={2.25} />
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
        <div className="elev-1 w-72 rounded-card bg-surface-overlay p-2">
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
          <Toggle
            label="Allow file writes (edit)"
            value={perms.allowFileWrites}
            onChange={(v) => onToggle({ allowFileWrites: v })}
          />
          <Toggle
            label="Allow shell commands (bash)"
            value={perms.allowBash}
            onChange={(v) => onToggle({ allowBash: v })}
          />
          <Toggle
            label="Allow web search"
            value={perms.allowWebSearch}
            onChange={(v) => onToggle({ allowWebSearch: v })}
          />
          <div className="mt-2 px-2 text-meta text-text-faint">
            Disabled tools will trigger a confirmation prompt instead of running.
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
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      className="flex w-full items-center justify-between rounded-inner px-2 py-1.5 text-row text-text-secondary transition-colors duration-150 hover:bg-surface-hover"
    >
      <span>{label}</span>
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors duration-150',
          value ? 'bg-accent' : 'bg-border-strong'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-surface-base transition-all duration-150',
            value ? 'left-3.5' : 'left-0.5'
          )}
        />
      </span>
    </button>
  );
}
