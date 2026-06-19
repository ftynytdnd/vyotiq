/**
 * Invalidate capture source cache when display topology changes.
 */

import { screen } from 'electron';
import { logger } from '../logging/logger.js';
import { invalidateCaptureSourceListCache } from './captureManager.js';

const log = logger.child('capture/display-watch');
let registered = false;

export function registerCaptureDisplayWatch(): void {
  if (registered) return;
  registered = true;

  const invalidate = (reason: string) => {
    log.debug('invalidating capture source cache', { reason });
    invalidateCaptureSourceListCache();
  };

  screen.on('display-added', () => invalidate('display-added'));
  screen.on('display-removed', () => invalidate('display-removed'));
  screen.on('display-metrics-changed', () => invalidate('display-metrics-changed'));
}
