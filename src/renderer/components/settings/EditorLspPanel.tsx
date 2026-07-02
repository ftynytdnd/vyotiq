/**
 * Settings → Agent behavior — optional LSP for the in-app editor.
 */

import { useEffect, useMemo, useState } from 'react';
import { resolveEditorLspSettings } from '@shared/settings/editorLspSettings.js';
import { useSettingsPatch } from '../../hooks/useSettingsPatch.js';
import {
  fetchLspStatus,
  hasActiveLspClients,
  invalidateLspClients
} from '../../lib/lspWorkspaceClient.js';
import { vyotiq } from '../../lib/ipc.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { ShellCaption, ShellFieldLabel, ShellRow, ShellSection } from '../ui/ShellSection.js';
import { TextField } from '../ui/TextField.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

const BUILT_IN_SERVERS = [
  'Pyright — Python (.py)',
  'TypeScript Language Server — TypeScript / JavaScript (.ts, .js, .tsx, .jsx)'
] as const;

const PER_LANGUAGE_ROWS: Array<{ id: string; label: string; placeholder: string }> = [
  { id: 'python', label: 'Python override (optional)', placeholder: 'Leave empty to use built-in Pyright' },
  {
    id: 'typescript',
    label: 'TypeScript / JavaScript override (optional)',
    placeholder: 'Leave empty to use built-in TypeScript Language Server'
  }
];

export function EditorLspPanel() {
  const { settings, apply: applySettings } = useSettingsPatch('editor LSP settings');
  const resolved = resolveEditorLspSettings(settings.ui);
  const lsp = settings.ui?.editorLsp ?? {};
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaceKnown = useWorkspaceStore(
    (s) => activeWorkspaceId != null && s.list.some((workspace) => workspace.id === activeWorkspaceId)
  );
  const [preview, setPreview] = useState<{
    connected: boolean;
    pid: number | null;
    lastError: string | null;
    configSource: string;
  } | null>(null);

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['editorLsp']>) => {
    applySettings({ ui: { editorLsp: { ...lsp, ...patch } } });
    if (activeWorkspaceId) {
      invalidateLspClients(activeWorkspaceId);
    }
  };

  const argsText = Array.isArray(lsp.args) ? lsp.args.join(' ') : '--stdio';

  const configFingerprint = useMemo(
    () =>
      JSON.stringify({
        enabled: resolved.enabled,
        command: lsp.command ?? '',
        args: lsp.args ?? [],
        languages: lsp.languages ?? {}
      }),
    [lsp.args, lsp.command, lsp.languages, resolved.enabled]
  );

  useEffect(() => {
    if (!resolved.enabled || !activeWorkspaceId || !workspaceKnown) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    let connectedByPanel = false;

    const poll = () => {
      void fetchLspStatus(activeWorkspaceId, 'python').then((st) => {
        if (cancelled) return;
        setPreview({
          connected: st.status.connected,
          pid: st.status.pid,
          lastError: st.reason ?? st.status.lastError,
          configSource: st.configSource
        });
      });
    };

    void vyotiq.lsp
      .connect({ workspaceId: activeWorkspaceId, languageId: 'python' })
      .then(() => {
        connectedByPanel = true;
      })
      .finally(() => {
        if (!cancelled) poll();
      });

    const id = window.setInterval(poll, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (
        connectedByPanel &&
        activeWorkspaceId &&
        !hasActiveLspClients(activeWorkspaceId)
      ) {
        void vyotiq.lsp.disconnect({ workspaceId: activeWorkspaceId });
      }
    };
  }, [resolved.enabled, configFingerprint, activeWorkspaceId, workspaceKnown]);

  const setLanguageCommand = (languageId: string, command: string) => {
    const languages = { ...(lsp.languages ?? {}) };
    const trimmed = command.trim();
    if (!trimmed) {
      delete languages[languageId];
    } else {
      languages[languageId] = { command: trimmed, args: ['--stdio'] };
    }
    apply({ languages });
  };

  return (
    <ShellSection className="vx-editor-lsp-panel">
      <ShellCaption>
        Built-in language servers ship with Vyotiq — no separate install required for Python and
        TypeScript / JavaScript. They power diagnostics, hover tooltips, Ctrl+Space completion, F2
        rename, Shift+F12 find references, Mod+. code actions, and F12 / Alt+click go-to-definition
        in the workspace editor. Tab accepts AI inline ghost text first when visible; otherwise LSP
        completion applies. Optional command overrides below replace the built-in server for that
        language. Workspace-level overrides live in <code>.vyotiq/lsp.json</code>.
      </ShellCaption>
      <ShellRow>
        <ShellFieldLabel>Built-in servers</ShellFieldLabel>
        <ul className="list-inside list-disc text-meta text-text-secondary">
          {BUILT_IN_SERVERS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </ShellRow>
      {preview ? (
        <ShellRow>
          <ShellFieldLabel>Live status</ShellFieldLabel>
          <p className="font-mono text-meta text-text-secondary">
            {preview.connected ? (
              <>
                <span className="text-success">Connected</span>
                {preview.pid != null ? ` · pid ${preview.pid}` : ''}
                {preview.configSource === 'bundled'
                  ? ' · built-in Pyright'
                  : preview.configSource === 'workspace'
                    ? ' · workspace override'
                    : preview.configSource === 'global'
                      ? ' · custom command'
                      : ''}
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
        description="Start the built-in (or overridden) language server for open editor tabs."
        value={resolved.enabled}
        onChange={(enabled) => apply({ enabled })}
      />
      <ShellRow>
        <ShellFieldLabel htmlFor="editor-lsp-command">Default override</ShellFieldLabel>
        <TextField
          id="editor-lsp-command"
          placeholder="Optional — built-in servers used when empty"
          value={lsp.command ?? ''}
          disabled={!resolved.enabled}
          onChange={(e) => apply({ command: e.target.value })}
        />
      </ShellRow>
      <ShellRow>
        <ShellFieldLabel htmlFor="editor-lsp-args">Default arguments</ShellFieldLabel>
        <TextField
          id="editor-lsp-args"
          placeholder="--stdio"
          value={argsText}
          disabled={!resolved.enabled}
          onChange={(e) =>
            apply({
              args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : ['--stdio']
            })
          }
        />
      </ShellRow>
      {PER_LANGUAGE_ROWS.map((row) => (
        <ShellRow key={row.id}>
          <ShellFieldLabel htmlFor={`editor-lsp-lang-${row.id}`}>{row.label}</ShellFieldLabel>
          <TextField
            id={`editor-lsp-lang-${row.id}`}
            placeholder={row.placeholder}
            value={lsp.languages?.[row.id]?.command ?? ''}
            disabled={!resolved.enabled}
            onChange={(e) => setLanguageCommand(row.id, e.target.value)}
          />
        </ShellRow>
      ))}
    </ShellSection>
  );
}
