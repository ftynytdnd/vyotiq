import { useEffect, useState, type ReactNode } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { vyotiq } from '../../lib/ipc.js';
import { TITLEBAR_WINDOW_ZONE_CLASS } from './titlebarShared.js';
import { cn } from '../../lib/cn.js';

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void vyotiq.window.isMaximized().then(setIsMaximized);
    const off = vyotiq.window.onStateChanged((state) => setIsMaximized(state.isMaximized));
    return off;
  }, []);

  return (
    <div className={TITLEBAR_WINDOW_ZONE_CLASS}>
      <WindowControlButton
        label="Minimize"
        onClick={() => void vyotiq.window.minimize()}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2.25} />
      </WindowControlButton>
      <WindowControlButton
        label={isMaximized ? 'Restore' : 'Maximize'}
        onClick={() => void vyotiq.window.maximizeToggle()}
      >
        {isMaximized ? (
          <Copy className="h-3.5 w-3.5 -scale-x-100" strokeWidth={2.25} />
        ) : (
          <Square className="h-3 w-3" strokeWidth={2.25} />
        )}
      </WindowControlButton>
      <WindowControlButton
        label="Close"
        danger
        onClick={() => void vyotiq.window.close()}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.25} />
      </WindowControlButton>
    </div>
  );
}

function WindowControlButton({
  label,
  onClick,
  danger,
  children
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'app-no-drag inline-flex h-8 w-10 items-center justify-center rounded-inner',
        'text-text-muted transition-colors duration-150',
        'hover:bg-surface-hover hover:text-text-primary',
        danger &&
          'hover:bg-danger-strong hover:text-text-primary focus-visible:bg-danger-strong focus-visible:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
