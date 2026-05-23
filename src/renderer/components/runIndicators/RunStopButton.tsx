import { Square } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { useChatStore } from '../../store/useChatStore.js';

interface RunStopButtonProps {
  runId: string;
  conversationTitle: string;
}

export function RunStopButton({ runId, conversationTitle }: RunStopButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Stop run in ${conversationTitle}`}
      title="Stop"
      onClick={(e) => {
        e.stopPropagation();
        void useChatStore.getState().abortRun(runId);
      }}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner',
        'opacity-0 transition-opacity duration-150',
        'group-hover:opacity-60 group-focus-within:opacity-60',
        'hover:opacity-100 focus-visible:opacity-100 hover:text-text-primary'
      )}
    >
      <Square className="h-3 w-3 fill-current" strokeWidth={2.25} />
    </button>
  );
}
