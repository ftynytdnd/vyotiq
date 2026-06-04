/**
 * Streams the assistant's output as rendered markdown (GFM + syntax-highlighted
 * code fences). Reads from the chat-store accumulator so reruns and re-mounts
 * don't lose the buffered text.
 *
 * While streaming, uses `StreamingMarkdownBody` for a token-aware partial
 * renderer (flush inline prose). On settle, hands off to the
 * full `MarkdownBody` for GFM + highlight.js.
 *
 * The model sometimes emits legacy orchestration XML scaffolding around
 * its user-facing answer; `stripDelegatesForDisplay` removes it before the
 * text reaches the markdown parser.
 */

import { Copy, Check } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { AGENT_NAME } from '@shared/constants.js';
import { stripEmoji } from '@shared/text/emoji.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { displayAssistantTurnText } from '../../../lib/text.js';
import { StreamingMarkdownBody } from '../markdown/StreamingMarkdownBody.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.js';
import { timelineActionPillClassName, timelineAssistantRowClassName } from '../shared/rowStyles.js';

interface AssistantTextRowProps {
  id: string;
  model?: ModelSelection | null;
}

export function AssistantTextRow({ id, model: _model }: AssistantTextRowProps) {
  const acc = useChatStore((s) => s.assistantTexts[id]);

  const { copied, copy } = useCopyFeedback();

  if (!acc) return null;
  const cleaned = displayAssistantTurnText(acc.text);
  const streamingEmpty = cleaned.length === 0 && !acc.done;

  if (cleaned.length === 0 && acc.done) return null;

  const handleCopy = (): void => {
    void copy(stripEmoji(cleaned), { context: 'assistant-row' });
  };

  return (
    // Tail-stick is intentionally omitted here — the timeline-level
    // sticky scroll bit keeps the viewport pinned during prose streams.
    <div
      className={timelineAssistantRowClassName}
      data-row-kind="assistant-text"
      aria-label={`${AGENT_NAME} response`}
    >
      <div className="flex flex-col gap-1.5">
        {streamingEmpty ? (
          <div
            className="h-4 w-3/5 max-w-xs animate-pulse rounded-inner bg-surface-overlay/30"
            aria-hidden
          />
        ) : (
          <StreamingMarkdownBody text={acc.text} done={acc.done} />
        )}
      </div>
      <div className="flex items-center gap-1 pt-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
        <button
          type="button"
          onClick={handleCopy}
          className={timelineActionPillClassName}
          title={copied ? 'Copied' : 'Copy'}
          aria-label={copied ? 'Copied response' : 'Copy response'}
        >
          {copied ? (
            <Check className={cn(SHELL_ROW_ICON_CLASS, 'text-success')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          ) : (
            <Copy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}
