/** Main → renderer toast notification (scoped, low-noise). */

export type UiToastVariant = 'info' | 'success' | 'danger';

export interface UiToastPayload {
  message: string;
  variant?: UiToastVariant;
  /** When set, the renderer may show only for the active conversation. */
  conversationId?: string;
}
