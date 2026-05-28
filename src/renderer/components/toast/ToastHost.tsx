/**
 * ToastHost — fixed-position stack that renders the active queue from
 * `useToastStore`. Mount this once near the app root. The host is purely
 * the visual surface; lifecycle (show / dismiss / auto-expire) lives in
 * the store. Styling stays flush with the stealth-dark palette and
 * deliberately does NOT use a card chrome.
 */

import { X, AlertCircle, Info, CheckCircle2 } from 'lucide-react';
import { useToastStore, type Toast } from '../../store/useToastStore.js';
import { chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastRow
          key={t.id}
          toast={t}
          onDismiss={() => dismiss(t.id)}
          onPause={() => pause(t.id)}
          onResume={() => resume(t.id)}
        />
      ))}
    </div>
  );
}

interface ToastRowProps {
  toast: Toast;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
}

function ToastRow({ toast, onDismiss, onPause, onResume }: ToastRowProps) {
  const Icon =
    toast.tone === 'success'
      ? CheckCircle2
      : toast.tone === 'danger'
        ? AlertCircle
        : Info;

  const toneClass =
    toast.tone === 'success'
      ? 'text-success'
      : toast.tone === 'danger'
        ? 'text-danger'
        : 'text-accent';

  return (
    <div
      role="status"
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={onResume}
      className={cn(
        chromePopoverPanelClassName,
        'pointer-events-auto flex max-w-sm items-start gap-2 border-l-2 px-3 py-2',
        toast.tone === 'success'
          ? 'border-l-success'
          : toast.tone === 'danger'
            ? 'border-l-danger'
            : 'border-l-accent/70'
      )}
    >
      <Icon className={cn(SHELL_ROW_ICON_CLASS, toneClass)} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      <div className="min-w-0 flex-1 text-row leading-relaxed text-text-primary">
        {toast.message}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="app-no-drag vx-btn vx-btn-quiet h-5 w-5 shrink-0 px-0"
        aria-label="Dismiss"
      >
        <X className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
    </div>
  );
}
