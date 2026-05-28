/**
 * Plays the OS warning sound when a destructive confirm reaches its
 * armed step. Best-effort — failures are ignored so confirms never
 * block on audio.
 */

import { vyotiq } from './ipc.js';

export function playDestructiveWarningSound(): void {
  const play = vyotiq.app.playWarningSound;
  if (typeof play !== 'function') return;
  void play.call(vyotiq.app).catch(() => {
    /* Audio is optional UX polish. */
  });
}
