/**
 * xterm.js surface for the workspace PTY.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { vyotiq } from '../../lib/ipc.js';

export interface XtermViewProps {
  workspaceId: string;
  active: boolean;
}

export function XtermView({ workspaceId, active }: XtermViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'var(--font-mono), ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 4000
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const pushResize = () => {
      fit.fit();
      const cols = term.cols;
      const rows = term.rows;
      void vyotiq.terminal.resize({ workspaceId: workspaceRef.current, cols, rows });
    };

    const onData = (data: string) => {
      void vyotiq.terminal.input({ workspaceId: workspaceRef.current, data });
    };

    const unsubData = vyotiq.terminal.onData((event) => {
      if (event.workspaceId !== workspaceRef.current) return;
      term.write(event.data);
    });

    const unsubExit = vyotiq.terminal.onExit((event) => {
      if (event.workspaceId !== workspaceRef.current) return;
      term.writeln(`\r\n\x1b[38;5;245m[shell exited ${event.exitCode}]\x1b[0m`);
    });

    term.onData(onData);
    pushResize();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => pushResize()) : null;
    ro?.observe(host);
    window.addEventListener('resize', pushResize);

    return () => {
      window.removeEventListener('resize', pushResize);
      ro?.disconnect();
      unsubData();
      unsubExit();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [active, workspaceId]);

  return <div ref={hostRef} className="vx-xterm-host h-full min-h-0 w-full" />;
}
