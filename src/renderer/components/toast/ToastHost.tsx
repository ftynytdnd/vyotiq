/**
 * ToastHost — fixed-position stack that renders the active queue from
 * `useToastStore`. Mount this once near the app root. The host is purely
 * the visual surface; lifecycle (show / dismiss / auto-expire) lives in
 * the store. Styling stays flush with the stealth-dark palette and
 * deliberately does NOT use a card chrome.
 */

import { X, AlertCircle, Info, CheckCircle2 } from 'lucide-react';
import { useToastStore, type Toast } from '../../store/useToastStore.js';
import { cn } from '../../lib/cn.js';

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
        'elev-1 pointer-events-auto flex max-w-sm items-start gap-2 rounded-card bg-surface-overlay px-3 py-2'
      )}
    >
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', toneClass)} strokeWidth={2.25} />
      <div className="min-w-0 flex-1 text-row leading-relaxed text-text-primary">
        {toast.message}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="app-no-drag -mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" strokeWidth={2.25} />
      </button>
    </div>
  );
}
