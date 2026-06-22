/**
 * Open OS screen-capture privacy settings (toast companion).
 */

import { isMacPlatform } from './resolveKeybindings.js';
import { vyotiq } from './ipc.js';

export async function openCapturePermissionSettings(): Promise<void> {
  const url = isMacPlatform()
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    : 'ms-settings:privacy-screen';
  try {
    await vyotiq.browser.openExternal({ url });
  } catch {
    /* shell may be unavailable in tests */
  }
}
