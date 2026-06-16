/**
 * Raw LSP JSON-RPC relay over stdio — no host-side initialize.
 * @codemirror/lsp-client owns the protocol exchange in the renderer.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { logger } from '../logging/logger.js';
import { buildLspSpawnSpec } from './lspCommandResolve.js';
import type { ResolvedLspServerConfig } from './lspWorkspaceConfig.js';

const log = logger.child('lsp/relay');

export interface LspRelayStatus {
  connected: boolean;
  pid: number | null;
  lastError: string | null;
}

type MessageListener = (message: string) => void;

export class LspRelaySession {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private listeners = new Set<MessageListener>();
  private lastError: string | null = null;
  private starting: Promise<void> | null = null;

  constructor(
    readonly server: ResolvedLspServerConfig,
    private readonly workspaceRoot: string
  ) {}

  get command(): string {
    return this.server.command;
  }

  get args(): string[] {
    return this.server.args;
  }

  getStatus(): LspRelayStatus {
    return {
      connected: this.proc != null && !this.proc.killed,
      pid: this.proc?.pid ?? null,
      lastError: this.lastError
    };
  }

  onMessage(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.proc && !this.proc.killed) return;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      this.lastError = null;
      const spec = await buildLspSpawnSpec(this.server, this.workspaceRoot);
      const proc = spawn(spec.file, spec.argv, {
        cwd: this.workspaceRoot,
        stdio: 'pipe',
        windowsHide: true,
        env: spec.env,
        shell: spec.shell
      });
      this.proc = proc;

      await new Promise<void>((resolve) => {
        proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')));
        proc.stderr.on('data', (chunk: Buffer) => {
          log.debug('lsp stderr', { text: chunk.toString('utf8').slice(0, 200) });
        });
        proc.on('error', (err) => {
          this.lastError = err.message;
          this.proc = null;
          log.warn('lsp spawn error', {
            err: err.message,
            command: this.server.command,
            file: spec.file
          });
          resolve();
        });
        proc.on('spawn', () => {
          resolve();
        });
        proc.on('exit', (code) => {
          log.info('lsp relay exited', { code, command: this.server.command });
          this.proc = null;
          if (code != null && code !== 0) {
            this.lastError = `Language server exited (${code})`;
          }
        });
      });
    })().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  send(message: string): void {
    if (!this.proc?.stdin.writable) {
      this.lastError = 'Language server not connected';
      return;
    }
    const body = message;
    const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
    this.proc.stdin.write(frame, 'utf8');
  }

  async stop(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined);
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
    this.buffer = '';
    this.listeners.clear();
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
      for (const listener of this.listeners) listener(body);
    }
  }
}
