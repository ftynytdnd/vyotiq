/**
 * Resolved defaults for `settings.ui.editorLsp`.
 */

import type { AppSettings } from '../types/ipc.js';

export type EditorLspSettings = NonNullable<NonNullable<AppSettings['ui']>['editorLsp']> & {
  enabled: boolean;
};

export const DEFAULT_EDITOR_LSP_SETTINGS: Pick<EditorLspSettings, 'enabled'> = {
  enabled: true
} as const;

export function resolveEditorLspSettings(ui?: AppSettings['ui']): EditorLspSettings {
  const lsp = ui?.editorLsp;
  return {
    ...lsp,
    enabled: lsp?.enabled !== false
  };
}
