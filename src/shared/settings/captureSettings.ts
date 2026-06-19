/**
 * Resolved defaults for `settings.ui.capture`.
 */

import type { AppSettings } from '../types/ipc.js';

export type CaptureSettings = NonNullable<NonNullable<AppSettings['ui']>['capture']> & {
  redactWindowTitles: boolean;
};

export function resolveCaptureSettings(ui?: AppSettings['ui']): CaptureSettings {
  const capture = ui?.capture;
  return {
    ...capture,
    redactWindowTitles: capture?.redactWindowTitles === true
  };
}
