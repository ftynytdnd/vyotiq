/**
 * LSP workspace that opens cross-file targets in the Vyotiq editor.
 */

import { LSPPlugin, Workspace, type LSPClient } from '@codemirror/lsp-client';
import type { ChangeSet, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { openWorkspaceFileInEditor } from './openWorkspaceFileInEditor.js';
import { relPathFromFileUri } from './lspWorkspaceClient.js';

interface VyotiqWorkspaceFile {
  uri: string;
  languageId: string;
  version: number;
  doc: Text;
  view: EditorView;
  getView(): EditorView;
}

class VyotiqWorkspaceFileImpl implements VyotiqWorkspaceFile {
  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
    readonly view: EditorView
  ) {}

  getView(): EditorView {
    return this.view;
  }
}

export class VyotiqLspWorkspace extends Workspace {
  files: VyotiqWorkspaceFile[] = [];
  private fileVersions: Record<string, number> = Object.create(null) as Record<string, number>;

  constructor(
    client: LSPClient,
    private readonly workspaceId: string,
    private readonly rootUri: string
  ) {
    super(client);
  }

  private nextFileVersion(uri: string): number {
    this.fileVersions[uri] = (this.fileVersions[uri] ?? -1) + 1;
    return this.fileVersions[uri]!;
  }

  syncFiles() {
    const result: Array<{ changes: ChangeSet; file: VyotiqWorkspaceFile; prevDoc: Text }> = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        result.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view.state.doc;
        file.version = this.nextFileVersion(file.uri);
        plugin.clear();
      }
    }
    return result;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    if (this.getFile(uri)) {
      throw new Error("Vyotiq LSP workspace doesn't support multiple views on the same file");
    }
    const file = new VyotiqWorkspaceFileImpl(
      uri,
      languageId,
      this.nextFileVersion(uri),
      view.state.doc,
      view
    );
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string, view: EditorView): void {
    void view;
    const file = this.getFile(uri);
    if (file) {
      this.files = this.files.filter((f) => f !== file);
      this.client.didClose(uri);
    }
  }

  override async displayFile(uri: string): Promise<EditorView | null> {
    const existing = this.getFile(uri);
    if (existing) return existing.getView();

    const rel = relPathFromFileUri(this.rootUri, uri);
    if (!rel) return null;

    const opened = await openWorkspaceFileInEditor(rel, { workspaceId: this.workspaceId });
    if (!opened) return null;

    for (let attempt = 0; attempt < 40; attempt++) {
      const file = this.getFile(uri);
      const view = file?.getView() ?? null;
      if (view) return view;
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.getFile(uri)?.getView() ?? null;
  }
}
