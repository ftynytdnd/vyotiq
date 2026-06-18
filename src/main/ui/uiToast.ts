import { IPC } from '@shared/constants.js';
import type { UiToastPayload } from '@shared/types/uiToast.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';

/** Push a scoped toast to the renderer (no-op when the window is unavailable). */
export function notifyUiToast(payload: UiToastPayload): void {
  safeWebContentsSend(IPC.UI_TOAST, payload);
}
