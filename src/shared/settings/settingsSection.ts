/**
 * Task-based settings section ids (renderer + persistence).
 */

export type SettingsSectionId =
  | 'models-api'
  | 'agent-behavior'
  | 'workspace-data'
  | 'appearance'
  | 'shortcuts'
  | 'about';

const SETTINGS_SECTION_IDS: SettingsSectionId[] = [
  'models-api',
  'agent-behavior',
  'workspace-data',
  'appearance',
  'shortcuts',
  'about'
];

function isSettingsSectionId(value: string | undefined): value is SettingsSectionId {
  return value !== undefined && SETTINGS_SECTION_IDS.includes(value as SettingsSectionId);
}

/** Legacy flat tab ids and group ids → current section id. */
export function resolveSettingsSectionId(
  persisted: string | undefined,
  fallback: SettingsSectionId = 'models-api'
): SettingsSectionId {
  if (isSettingsSectionId(persisted)) return persisted;
  switch (persisted) {
    case 'providers':
    case 'permissions':
    case 'context':
    case 'checkpoints':
    case 'setup':
    case 'app':
      return 'models-api';
    case 'memory':
    case 'agent':
      return 'agent-behavior';
    case 'appearance':
      return 'appearance';
    case 'shortcuts':
      return 'shortcuts';
    case 'about':
      return 'about';
    case 'workspace-data':
      return 'workspace-data';
    default:
      return fallback;
  }
}

export function isPersistableSettingsSection(
  section: SettingsSectionId
): section is Exclude<SettingsSectionId, 'about'> {
  return section !== 'about';
}

/** Human-readable labels for settings sections (nav, title bar, headers). */
export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  'models-api': 'Models & API',
  'agent-behavior': 'Agent behavior',
  'workspace-data': 'Workspace data',
  appearance: 'Appearance',
  shortcuts: 'Shortcuts',
  about: 'About'
};
