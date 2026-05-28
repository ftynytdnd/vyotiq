/**
 * Permission mode pill — Ask vs Auto at a glance; click toggles directly.
 */

import { memo } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../lib/cn.js';
import {
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE
} from '../../lib/shellIcons.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

export const PermissionModePill = memo(function PermissionModePill() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const { settings, setPermissions, setPermissionsForWorkspace } = useSettingsStore(
    useShallow((s) => ({
      settings: s.settings,
      setPermissions: s.setPermissions,
      setPermissionsForWorkspace: s.setPermissionsForWorkspace
    }))
  );
  const perms = selectEffectivePermissions(activeWorkspaceId, settings);

  const auto = perms.allowAuto;
  const Icon = auto ? ShieldCheck : ShieldAlert;

  const onToggle = () => {
    const patch = { allowAuto: !auto };
    if (activeWorkspaceId) {
      void setPermissionsForWorkspace(activeWorkspaceId, patch);
    } else {
      void setPermissions(patch);
    }
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      title={auto ? 'Auto — click to require confirmation' : 'Ask — click for auto mode'}
      className={cn(
        'vx-btn vx-btn-quiet inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-meta',
        auto ? 'text-accent' : 'text-text-muted'
      )}
    >
      <Icon className={SHELL_MICRO_ICON_CLASS} strokeWidth={SHELL_MICRO_ICON_STROKE} />
      {auto ? 'Auto' : 'Ask'}
    </button>
  );
});
