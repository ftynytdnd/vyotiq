import { useEffect, useState } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { vyotiq } from '../../lib/ipc.js';
import { cn } from '../../lib/cn.js';

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void vyotiq.window.isMaximized().then(setIsMaximized);
    const off = vyotiq.window.onStateChanged((state) => setIsMaximized(state.isMaximized));
    return off;
  }, []);

  const Btn = ({
    label,
    onClick,
    danger,
    children
  }: {
    label: string;
    onClick: () => void;
    danger?: boolean;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'app-no-drag inline-flex h-8 w-11 items-center justify-center text-text-muted',
        'transition-colors duration-150 hover:text-text-primary',
        danger ? 'hover:bg-danger/80 hover:text-white' : 'hover:bg-surface-hover'
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-stretch">
      <Btn label="Minimize" onClick={() => void vyotiq.window.minimize()}>
        <Minus className="h-3.5 w-3.5" strokeWidth={2.25} />
      </Btn>
      <Btn label={isMaximized ? 'Restore' : 'Maximize'} onClick={() => void vyotiq.window.maximizeToggle()}>
        {isMaximized ? (
          <Copy className="h-3.5 w-3.5 -scale-x-100" strokeWidth={2.25} />
        ) : (
          <Square className="h-3 w-3" strokeWidth={2.25} />
        )}
      </Btn>
      <Btn label="Close" danger onClick={() => void vyotiq.window.close()}>
        <X className="h-3.5 w-3.5" strokeWidth={2.25} />
      </Btn>
    </div>
  );
}
