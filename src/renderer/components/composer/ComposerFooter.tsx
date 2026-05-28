import type { ReactNode } from 'react';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { ComposerStatusStrip } from './ComposerStatusStrip.js';
import { SendButton } from './SendButton.js';
import { cn } from '../../lib/cn.js';

interface ComposerFooterProps {
  attachmentCount: number;
  meterPill?: ReactNode;
  sendState: 'idle' | 'ready' | 'processing';
  onSend: () => void;
  canSend: boolean;
  compact?: boolean;
}

export function ComposerFooter({
  attachmentCount,
  meterPill,
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
      {meterPill}
      <ComposerStatusStrip />
      {attachmentCount > 0 && (
        <span className="shrink-0 font-mono text-meta text-text-faint tabular-nums">
          {attachmentCount}/{MAX_CHAT_ATTACHMENTS}
        </span>
      )}
      <SendButton
        onClick={onSend}
        state={sendState}
        disabled={!canSend && sendState !== 'processing'}
      />
    </div>
  );
}
