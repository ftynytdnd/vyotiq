/**
 * Renderer-level React error boundary. Catches render errors, presents a
 * minimal recovery surface using existing tokens, and forwards the stack to
 * the main process logger via IPC. Never reuses pure-black backgrounds.
 */

import React from 'react';

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
      window.vyotiq?.log('error', 'renderer crash', {
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack
      });
    } catch {
      /* noop */
    }
  }

  reset = (): void => this.setState({ error: null });

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-base p-8">
        <div className="elev-2 max-w-lg rounded-card bg-surface-raised p-6">
          <div className="text-body font-semibold text-text-primary">
            Something went wrong.
          </div>
          <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-row text-danger">
            {this.state.error.message}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => location.reload()}
              className="rounded-inner bg-surface-overlay px-3 py-1 text-row text-text-secondary transition-colors duration-150 hover:bg-surface-hover"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="rounded-inner bg-accent px-3 py-1 text-row text-surface-base transition-colors duration-150 hover:bg-accent-strong"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
