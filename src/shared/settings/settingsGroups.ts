/**
 * Settings group ids and legacy tab migration (shared by main + renderer).
 */

export type SettingsGroupId = 'setup' | 'agent';

const SETTINGS_GROUP_IDS: SettingsGroupId[] = ['setup', 'agent'];

function isSettingsGroupId(value: string | undefined): value is SettingsGroupId {
  return value !== undefined && SETTINGS_GROUP_IDS.includes(value as SettingsGroupId);
}

/** Map persisted `ui.lastSettingsTab` (legacy or current) to a group id. */
export function migrateLastSettingsTab(
  persisted: string | undefined,
  fallback: SettingsGroupId = 'setup'
): SettingsGroupId {
  if (persisted === 'app') return 'setup';
  if (isSettingsGroupId(persisted)) return persisted;
  switch (persisted) {
    case 'providers':
    case 'appearance':
    case 'shortcuts':
    case 'about':
    case 'permissions':
    case 'context':
    case 'checkpoints':
      return 'setup';
    case 'memory':
      return 'agent';
    default:
      return fallback;
  }
}
