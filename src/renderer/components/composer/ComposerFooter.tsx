import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { SendButton } from './SendButton.js';
import { cn } from '../../lib/cn.js';

interface ComposerFooterProps {
  attachmentCount: number;
  sendState: 'idle' | 'ready' | 'processing';
  onSend: () => void;
  canSend: boolean;
  compact?: boolean;
}

export function ComposerFooter({
  attachmentCount,
  sendState,
  onSend,
  canSend,
  compact = false
}: ComposerFooterProps) {
  return (
    <div
      className={cn(
        'vx-composer-footer flex min-w-0 items-center gap-1.5 border-t border-border-subtle/25',
        compact && 'vx-composer-footer--compact'
      )}
    >
      {attachmentCount > 0 && (
        <span className="shrink-0 font-mono text-meta text-text-faint tabular-nums">
          {attachmentCount}/{MAX_CHAT_ATTACHMENTS}
        </span>
      )}
      <div className="min-w-0 flex-1" aria-hidden />
      <SendButton
        onClick={onSend}
        state={sendState}
        disabled={!canSend && sendState !== 'processing'}
      />
    </div>
  );
}
