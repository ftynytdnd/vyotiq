/**
 * Region-scoped React error boundary — same recovery pattern as
 * {@link ErrorBoundary} but scoped to a single shell region (timeline,
 * settings, editor) with a human-readable label in the fallback UI.
 */

import React from 'react';
import { Button } from './ui/Button.js';
import { ShellCaption, ShellFieldActions } from './ui/ShellSection.js';

interface RegionErrorBoundaryProps {
  children: React.ReactNode;
  label: string;
}

interface RegionErrorBoundaryState {
  error: Error | null;
  resetKey: number;
}

class RegionErrorBoundaryInner extends React.Component<
  RegionErrorBoundaryProps,
  RegionErrorBoundaryState
> {
  state: RegionErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<RegionErrorBoundaryState> {
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
      window.vyotiq?.log('error', `renderer crash (${this.props.label})`, {
        message: error.message,
        stack: error.stack,
        label: this.props.label,
        ...(componentStack ? { componentStack } : {})
      });
    } catch {
      /* noop */
    }
  }

  reset = (): void => this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));

  override render(): React.ReactNode {
    if (!this.state.error) {
      return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
    }

    const staleChunk =
      this.state.error.message.includes('Failed to fetch dynamically imported module') ||
      this.state.error.message.includes('Importing a module script failed');

    return (
      <div
        className="flex h-full min-h-0 w-full items-center justify-center bg-surface-base p-6"
        role="alert"
        aria-live="assertive"
      >
        <div className="vx-panel-frame max-w-lg border border-border-subtle/18 shadow-modal">
          <div className="vx-panel-head">
            <h2 className="vx-panel-title">
              {staleChunk
                ? `${this.props.label} is out of date`
                : `${this.props.label} encountered an error`}
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

export function RegionErrorBoundary({ children, label }: RegionErrorBoundaryProps) {
  return <RegionErrorBoundaryInner label={label}>{children}</RegionErrorBoundaryInner>;
}
