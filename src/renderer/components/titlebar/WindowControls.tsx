import { useEffect, useState, type ReactNode } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { vyotiq } from '../../lib/ipc.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_CHROME_ICON_CLASS,
  SHELL_WINDOW_ICON_STROKE
} from '../../lib/shellIcons.js';

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void vyotiq.window.isMaximized().then(setIsMaximized);
    const off = vyotiq.window.onStateChanged((state) => setIsMaximized(state.isMaximized));
    return off;
  }, []);

  return (
    <>
      <WindowControlButton
        label="Minimize"
        onClick={() => void vyotiq.window.minimize()}
      >
        <Minus className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_WINDOW_ICON_STROKE} />
      </WindowControlButton>
      <WindowControlButton
        label={isMaximized ? 'Restore' : 'Maximize'}
        onClick={() => void vyotiq.window.maximizeToggle()}
      >
        {isMaximized ? (
          <Copy
            className={cn(SHELL_CHROME_ICON_CLASS, '-scale-x-100')}
            strokeWidth={SHELL_WINDOW_ICON_STROKE}
          />
        ) : (
          <Square className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_WINDOW_ICON_STROKE} />
        )}
      </WindowControlButton>
      <WindowControlButton
        label="Close"
        danger
        onClick={() => void vyotiq.window.close()}
      >
        <X className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_WINDOW_ICON_STROKE} />
      </WindowControlButton>
    </>
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
        'app-no-drag vx-window-control h-8 w-10',
        danger && 'vx-window-control--danger'
      )}
    >
      {children}
    </button>
  );
}
