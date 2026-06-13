/**
 * Settings → Agent behavior — optional LSP for the in-app editor.
 */

import { useEffect, useState } from 'react';
import { useSettingsPatch } from '../../hooks/useSettingsPatch.js';
import { fetchLspStatus } from '../../lib/lspWorkspaceClient.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { ShellCaption, ShellFieldLabel, ShellRow, ShellSection } from '../ui/ShellSection.js';
import { TextField } from '../ui/TextField.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

export function EditorLspPanel() {
  const { settings, apply: applySettings } = useSettingsPatch('editor LSP settings');
  const lsp = settings.ui?.editorLsp ?? {};
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const [preview, setPreview] = useState<{
    connected: boolean;
    pid: number | null;
    lastError: string | null;
    configSource: string;
  } | null>(null);

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['editorLsp']>) => {
    applySettings({ ui: { editorLsp: { ...lsp, ...patch } } });
  };

  const argsText = Array.isArray(lsp.args) ? lsp.args.join(' ') : '--stdio';

  useEffect(() => {
    if (!lsp.enabled || !activeWorkspaceId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      void fetchLspStatus(activeWorkspaceId).then((st) => {
        if (cancelled) return;
        setPreview({
          connected: st.status.connected,
          pid: st.status.pid,
          lastError: st.status.lastError,
          configSource: st.configSource
        });
      });
    };
    poll();
    const id = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [lsp.enabled, lsp.command, argsText, activeWorkspaceId]);

  return (
    <ShellSection title="Editor language server" className="vx-editor-lsp-panel">
      <ShellCaption>
        Optional stdio LSP for diagnostics, hover tooltips, Ctrl+Space completion,
        F2 rename, Shift+F12 find references, Mod+. code actions, and F12 / Alt+click
        go-to-definition in the workspace editor. Tab accepts AI inline ghost text
        first when visible; otherwise LSP completion applies. Install a language server (e.g.{' '}
        <code>typescript-language-server --stdio</code>) and point the command below. Per-workspace
        overrides live in <code>.vyotiq/lsp.json</code> (command, args, enabled).
      </ShellCaption>
      {preview ? (
        <ShellRow>
          <ShellFieldLabel>Live status</ShellFieldLabel>
          <p className="font-mono text-meta text-text-secondary">
            {preview.connected ? (
              <>
                <span className="text-success">Connected</span>
                {preview.pid != null ? ` · pid ${preview.pid}` : ''}
                {preview.configSource === 'workspace' ? ' · workspace override' : ''}
              </>
            ) : (
              <span className="text-warning">
                {preview.lastError ?? 'Not connected — open the editor to start the server'}
              </span>
            )}
          </p>
        </ShellRow>
      ) : null}
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
