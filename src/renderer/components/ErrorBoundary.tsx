/**
 * Renderer-level React error boundary. Catches render errors, presents a
 * minimal recovery surface using existing tokens, and forwards the stack to
 * the main process logger via IPC. Never reuses pure-black backgrounds.
 *
 * Recovery actions route through the shared `Button` primitive so the
 * boundary uses the same shape / padding / hover transition as every
 * other dialog action surface in the app — instead of hand-rolled
 * `<button>` elements that drift from the rest of the renderer's
 * action-button rhythm.
 */

import React from 'react';
import { Button } from './ui/Button.js';
import { ShellCaption, ShellFieldActions } from './ui/ShellSection.js';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      const componentStack =
        info.componentStack ??
        (typeof (info as { digest?: string }).digest === 'string'
          ? (info as { digest: string }).digest
          : undefined) ??
        error.stack;
      window.vyotiq?.log('error', 'renderer crash', {
        message: error.message,
        stack: error.stack,
        ...(componentStack ? { componentStack } : {})
      });
    } catch {
      /* noop */
    }
  }

  reset = (): void => this.setState({ error: null });

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    const staleChunk =
      this.state.error.message.includes('Failed to fetch dynamically imported module') ||
      this.state.error.message.includes('Importing a module script failed');

    return (
      <div
        className="flex h-full w-full items-center justify-center bg-surface-base p-8"
        role="alert"
        aria-live="assertive"
      >
        <div className="vx-panel-frame max-w-lg border border-border-subtle/18 shadow-modal">
          <div className="vx-panel-head">
            <h2 className="vx-panel-title">
              {staleChunk ? 'App build is out of date' : 'Something went wrong.'}
            </h2>
          </div>
          <div className="vx-panel-body flex flex-col gap-3">
            {staleChunk && (
              <ShellCaption>
                A panel loaded code from an older build. Reload the window to pick up the latest
                build.
              </ShellCaption>
            )}
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-row text-danger">
              {this.state.error.message}
            </div>
            <ShellFieldActions>
              {!staleChunk && (
                <Button variant="ghost" size="sm" onClick={this.reset}>
                  Try again
                </Button>
              )}
              <Button variant="primary" size="sm" onClick={() => location.reload()}>
                Reload
              </Button>
            </ShellFieldActions>
          </div>
        </div>
      </div>
    );
  }
}
