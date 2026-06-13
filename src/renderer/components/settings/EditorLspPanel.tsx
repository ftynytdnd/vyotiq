/**
 * Settings → Agent behavior — optional LSP for the in-app editor.
 */

import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { ShellCaption, ShellFieldLabel, ShellRow, ShellSection } from '../ui/ShellSection.js';
import { TextField } from '../ui/TextField.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

export function EditorLspPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const refresh = useSettingsStore((s) => s.refresh);
  const lsp = settings.ui?.editorLsp ?? {};

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['editorLsp']>) => {
    void vyotiq.settings
      .set({ ui: { editorLsp: { ...lsp, ...patch } } })
      .then(() => refresh())
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save editor LSP settings: ${msg}`, 'danger');
      });
  };

  const argsText = Array.isArray(lsp.args) ? lsp.args.join(' ') : '--stdio';

  return (
    <ShellSection title="Editor language server" className="vx-editor-lsp-panel">
      <ShellCaption>
        Optional stdio LSP for diagnostics and Alt+click go-to-definition in the workspace editor.
        Install a language server (e.g. <code>typescript-language-server --stdio</code>) and point
        the command below.
      </ShellCaption>
      <SettingsSwitchRow
        label="Enable LSP bridge"
        description="Spawn the configured language server for open editor tabs."
        value={lsp.enabled === true}
        onChange={(enabled) => apply({ enabled })}
      />
      <ShellRow>
        <ShellFieldLabel htmlFor="editor-lsp-command">Command</ShellFieldLabel>
        <TextField
          id="editor-lsp-command"
          placeholder="typescript-language-server"
          value={lsp.command ?? ''}
          disabled={!lsp.enabled}
          onChange={(e) => apply({ command: e.target.value })}
        />
      </ShellRow>
      <ShellRow>
        <ShellFieldLabel htmlFor="editor-lsp-args">Arguments</ShellFieldLabel>
        <TextField
          id="editor-lsp-args"
          placeholder="--stdio"
          value={argsText}
          disabled={!lsp.enabled}
          onChange={(e) =>
            apply({
              args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : []
            })
          }
        />
      </ShellRow>
    </ShellSection>
  );
}
