/**
 * Minimal LSP JSON-RPC over stdio (Content-Length framing).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { logger } from '../logging/logger.js';

const log = logger.child('lsp/jsonRpc');

export interface LspDiagnostic {
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface LspLocation {
  filePath: string;
  line: number;
  character: number;
}

export interface LspCompletionItem {
  label: string;
  insertText: string;
  detail?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class LspSession {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = '';
  private pending = new Map<number, PendingRequest>();
  private diagnosticsListeners = new Set<(path: string, diags: LspDiagnostic[]) => void>();
  private workspaceRoot = '';
  private openVersions = new Map<string, number>();

  constructor(
    private readonly command: string,
    private readonly args: string[]
  ) {}

  onDiagnostics(listener: (path: string, diags: LspDiagnostic[]) => void): () => void {
    this.diagnosticsListeners.add(listener);
    return () => this.diagnosticsListeners.delete(listener);
  }

  async start(workspaceRoot: string): Promise<void> {
    if (this.proc) return;
    this.workspaceRoot = workspaceRoot;
    this.proc = spawn(this.command, this.args, {
      cwd: workspaceRoot,
      stdio: 'pipe',
      windowsHide: true
    });
    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')));
    this.proc.stderr.on('data', (chunk: Buffer) => {
      log.debug('lsp stderr', { text: chunk.toString('utf8').slice(0, 200) });
    });
    this.proc.on('exit', (code) => {
      log.info('lsp exited', { code });
      this.proc = null;
    });

    await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(workspaceRoot).href,
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          completion: { dynamicRegistration: false },
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false }
        }
      }
    });
    this.notify('initialized', {});
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.request('shutdown', null);
      this.notify('exit', {});
    } catch {
      /* noop */
    }
    this.proc.kill();
    this.proc = null;
    this.pending.clear();
    this.openVersions.clear();
  }

  async openDocument(relPath: string, languageId: string, text: string): Promise<void> {
    const version = (this.openVersions.get(relPath) ?? 0) + 1;
    this.openVersions.set(relPath, version);
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: this.uriFor(relPath),
        languageId,
        version,
        text
      }
    });
  }

  async changeDocument(relPath: string, text: string): Promise<void> {
    const version = (this.openVersions.get(relPath) ?? 0) + 1;
    this.openVersions.set(relPath, version);
    this.notify('textDocument/didChange', {
      textDocument: { uri: this.uriFor(relPath), version },
      contentChanges: [{ text }]
    });
  }

  async closeDocument(relPath: string): Promise<void> {
    this.notify('textDocument/didClose', {
      textDocument: { uri: this.uriFor(relPath) }
    });
    this.openVersions.delete(relPath);
  }

  async definition(relPath: string, line: number, character: number): Promise<LspLocation | null> {
    const result = await this.request('textDocument/definition', {
      textDocument: { uri: this.uriFor(relPath) },
      position: { line, character }
    });
    return parseLocation(result, this.workspaceRoot);
  }

  async hover(relPath: string, line: number, character: number): Promise<string | null> {
    const result = await this.request('textDocument/hover', {
      textDocument: { uri: this.uriFor(relPath) },
      position: { line, character }
    });
    return parseHover(result);
  }

  async completion(
    relPath: string,
    line: number,
    character: number
  ): Promise<LspCompletionItem[]> {
    const result = await this.request('textDocument/completion', {
      textDocument: { uri: this.uriFor(relPath) },
      position: { line, character }
    });
    return parseCompletions(result);
  }

  private uriFor(relPath: string): string {
    return pathToFileURL(join(this.workspaceRoot, relPath.replace(/\\/g, '/'))).href;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.slice(bodyStart, bodyStart + length);
      this.buffer = this.buffer.slice(bodyStart + length);
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        this.dispatch(msg);
      } catch (err) {
        log.warn('invalid lsp json', { err });
      }
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(String((msg.error as { message?: string }).message ?? 'lsp error')));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    const method = msg.method;
    if (method === 'textDocument/publishDiagnostics') {
      const params = msg.params as {
        uri?: string;
        diagnostics?: Array<{
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          message: string;
          severity?: number;
        }>;
      };
      const rel = uriToRelPath(params.uri ?? '', this.workspaceRoot);
      if (!rel) return;
      const diags: LspDiagnostic[] = (params.diagnostics ?? []).map((d) => ({
        line: d.range.start.line,
        character: d.range.start.character,
        endLine: d.range.end.line,
        endCharacter: d.range.end.character,
        message: d.message,
        severity: severityLabel(d.severity)
      }));
      for (const listener of this.diagnosticsListeners) listener(rel, diags);
    }
  }

  private send(payload: Record<string, unknown>): void {
    const body = JSON.stringify(payload);
    const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
    this.proc?.stdin.write(frame, 'utf8');
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`lsp request timeout: ${method}`));
      }, 15_000);
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }
}

function severityLabel(sev?: number): LspDiagnostic['severity'] {
  if (sev === 1) return 'error';
  if (sev === 2) return 'warning';
  return 'info';
}

function uriToRelPath(uri: string, workspaceRoot: string): string | null {
  try {
    const fileUrl = new URL(uri);
    const rootUrl = pathToFileURL(workspaceRoot);
    if (fileUrl.protocol !== 'file:') return null;
    const abs = decodeURIComponent(fileUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const root = decodeURIComponent(rootUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    if (!abs.startsWith(root)) return null;
    return abs.slice(root.length).replace(/^[/\\]/, '').replace(/\\/g, '/');
  } catch {
    return null;
  }
}

function parseLocation(result: unknown, workspaceRoot: string): LspLocation | null {
  const loc = Array.isArray(result) ? result[0] : result;
  if (!loc || typeof loc !== 'object') return null;
  const uri = (loc as { uri?: string }).uri;
  const range = (loc as { range?: { start?: { line?: number; character?: number } } }).range;
  const rel = uri ? uriToRelPath(uri, workspaceRoot) : null;
  if (!rel || !range?.start) return null;
  return {
    filePath: rel,
    line: range.start.line ?? 0,
    character: range.start.character ?? 0
  };
}

function parseHover(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const contents = (result as { contents?: unknown }).contents;
  if (typeof contents === 'string') return contents.trim() || null;
  if (Array.isArray(contents)) {
    const parts = contents
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { value?: string }).value === 'string') {
          return (part as { value: string }).value;
        }
        return '';
      })
      .filter(Boolean);
    const joined = parts.join('\n').trim();
    return joined.length > 0 ? joined : null;
  }
  if (contents && typeof contents === 'object' && typeof (contents as { value?: string }).value === 'string') {
    const v = (contents as { value: string }).value.trim();
    return v.length > 0 ? v : null;
  }
  return null;
}

function parseCompletions(result: unknown): LspCompletionItem[] {
  const items = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { items?: unknown[] }).items)
      ? (result as { items: unknown[] }).items
      : [];
  const out: LspCompletionItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as {
      label?: string | { label?: string };
      insertText?: string;
      textEdit?: { newText?: string };
      detail?: string;
    };
    const label =
      typeof item.label === 'string'
        ? item.label
        : typeof item.label?.label === 'string'
          ? item.label.label
          : null;
    if (!label) continue;
    const insertText = item.insertText ?? item.textEdit?.newText ?? label;
    out.push({
      label,
      insertText,
      ...(item.detail ? { detail: item.detail } : {})
    });
    if (out.length >= 50) break;
  }
  return out;
}
