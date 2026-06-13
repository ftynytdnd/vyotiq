/**
 * LSP code actions (Mod+.) — not bundled in @codemirror/lsp-client.
 */

import type { Extension } from '@codemirror/state';
import { LSPPlugin, type LSPClient } from '@codemirror/lsp-client';
import type { WorkspaceMapping } from '@codemirror/lsp-client';
import { keymap, showPanel, type EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';

interface CodeActionItem {
  title: string;
  kind?: string;
  edit?: {
    changes?: Record<
      string,
      Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>
    >;
  };
  command?: { command: string; title: string; arguments?: unknown[] };
}

function applyWorkspaceChanges(
  client: LSPClient,
  mapping: WorkspaceMapping,
  changes: NonNullable<CodeActionItem['edit']>['changes']
): void {
  if (!changes) return;
  for (const uri of Object.keys(changes)) {
    const lspChanges = changes[uri];
    if (!lspChanges?.length) continue;
    const file = client.workspace.getFile(uri);
    if (!file) continue;
    client.workspace.updateFile(uri, {
      changes: lspChanges.map((change) => ({
        from: mapping.mapPosition(uri, change.range.start),
        to: mapping.mapPosition(uri, change.range.end),
        insert: change.newText
      })),
      userEvent: 'codeAction'
    });
  }
}

const setCodeActionPanel = StateEffect.define<((view: EditorView) => { dom: HTMLElement; destroy?: () => void }) | null>();
const codeActionPanel = StateField.define<((view: EditorView) => { dom: HTMLElement; destroy?: () => void }) | null>({
  create: () => null,
  update(panel, tr) {
    for (const e of tr.effects) {
      if (e.is(setCodeActionPanel)) return e.value;
    }
    return panel;
  },
  provide: (f) => showPanel.from(f)
});

function closeCodeActionPanel(view: EditorView): boolean {
  const panel = view.state.field(codeActionPanel, false);
  if (!panel) return false;
  view.dispatch({ effects: setCodeActionPanel.of(null) });
  return true;
}

function showCodeActionList(
  view: EditorView,
  actions: CodeActionItem[],
  mapping: WorkspaceMapping,
  plugin: NonNullable<ReturnType<typeof LSPPlugin.get>>
): void {
  const panelFactory = (panelView: EditorView) => {
    const dom = document.createElement('div');
    dom.className = 'cm-lsp-code-action-panel vx-stack gap-1 p-2';
    dom.tabIndex = 0;
    dom.setAttribute('role', 'listbox');
    dom.setAttribute('aria-label', 'Code actions');

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'block w-full rounded-inner px-2 py-1 text-left text-meta text-text-secondary hover:bg-surface-raised/60';
      btn.textContent = action.title;
      btn.addEventListener('click', () => {
        closeCodeActionPanel(panelView);
        if (action.edit?.changes) {
          applyWorkspaceChanges(plugin.client, mapping, action.edit.changes);
        } else if (action.command) {
          void plugin.client
            .request('workspace/executeCommand', {
              command: action.command.command,
              arguments: action.command.arguments ?? []
            })
            .catch((err: unknown) => {
              plugin.reportError('Code action command failed', err);
            });
        }
        panelView.focus();
      });
      dom.appendChild(btn);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'absolute right-1 top-1 text-text-faint hover:text-text-secondary';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => {
      closeCodeActionPanel(panelView);
      panelView.focus();
    });
    dom.style.position = 'relative';
    dom.appendChild(close);

    return {
      dom,
      destroy: () => mapping.destroy()
    };
  };

  const effect =
    view.state.field(codeActionPanel, false) === undefined
      ? StateEffect.appendConfig.of(codeActionPanel.init(() => panelFactory))
      : setCodeActionPanel.of(panelFactory);
  view.dispatch({ effects: effect });
}

const showCodeActions: (view: EditorView) => boolean = (view) => {
  const plugin = LSPPlugin.get(view);
  if (!plugin) return false;
  if (plugin.client.serverCapabilities?.codeActionProvider === false) return false;

  plugin.client.sync();
  const head = view.state.selection.main.head;
  const pos = plugin.toPosition(head);

  void plugin.client.withMapping(async (mapping) => {
    try {
      const result = (await plugin.client.request('textDocument/codeAction', {
        textDocument: { uri: plugin.uri },
        range: { start: pos, end: pos },
        context: { diagnostics: [] }
      })) as CodeActionItem[] | null;

      const actions = (result ?? []).filter((a) => a && typeof a.title === 'string');
      if (actions.length === 0) {
        plugin.reportError('Code actions', new Error('No actions available'));
        return;
      }
      showCodeActionList(view, actions, mapping, plugin);
    } catch (err: unknown) {
      plugin.reportError('Code action request failed', err);
    }
  });

  return true;
};

export const codeActionKeymap = [
  { key: 'Mod-.', run: showCodeActions, preventDefault: true },
  { key: 'Escape', run: closeCodeActionPanel }
];

export function lspCodeActionExtensions(): Extension[] {
  return [codeActionPanel, keymap.of(codeActionKeymap)];
}
