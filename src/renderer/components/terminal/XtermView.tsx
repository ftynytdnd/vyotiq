/**
 * xterm.js surface for one PTY session. The terminal instance lives in a
 * persistent pool (so scrollback survives pane/tab switches); this view
 * just re-parents the pooled host element and keeps it fitted.
 */

import { useEffect, useRef } from 'react';
import {
  fitTerminalEntry,
  getTerminalEntry,
  openTerminalEntry
} from './terminalPool.js';

export interface XtermViewProps {
  sessionId: string;
  active: boolean;
}

export function XtermView({ sessionId, active }: XtermViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !active) return;

    let disposed = false;
    const entry = getTerminalEntry(sessionId);

    const attach = async () => {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          /* best-effort font readiness */
        }
      }
      if (disposed) return;
      mount.appendChild(entry.host);
      openTerminalEntry(entry);
      // Focus so the user can type immediately on open.
      entry.term.focus();
    };

    void attach();

    const pushResize = () => fitTerminalEntry(entry);
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => pushResize()) : null;
    ro?.observe(mount);
    window.addEventListener('resize', pushResize);

    return () => {
      disposed = true;
      ro?.disconnect();
      window.removeEventListener('resize', pushResize);
      // Detach (but keep the pooled instance + scrollback alive).
      if (entry.host.parentElement === mount) {
        mount.removeChild(entry.host);
      }
    };
  }, [active, sessionId]);

  return <div ref={mountRef} className="vx-xterm-mount h-full min-h-0 w-full" />;
}
