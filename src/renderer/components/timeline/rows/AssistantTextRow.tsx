/**
 * Streams the assistant's output as rendered markdown (GFM + syntax-highlighted
 * code fences). Reads from the chat-store accumulator so reruns and re-mounts
 * don't lose the buffered text.
 *
 * While streaming, uses `StreamingMarkdownBody` for a token-aware partial
 * renderer (Cursor-style flush inline prose). On settle, hands off to the
 * full `MarkdownBody` for GFM + highlight.js.
 *
 * The model sometimes emits internal `<delegate />` XML scaffolding around
 * its user-facing answer; `stripDelegatesForDisplay` removes it before the
 * text reaches the markdown parser.
 */

import { useEffect, useRef, useState } from 'react';
import { Copy, Check, RefreshCcw } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { AGENT_NAME } from '@shared/constants.js';
import { stripEmoji } from '@shared/text/emoji.js';
import { useChatStore } from '../../../store/useChatStore.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { displayAssistantTurnText } from '../../../lib/text.js';
import { StreamingMarkdownBody } from '../markdown/StreamingMarkdownBody.js';
import { cn } from '../../../lib/cn.js';
import { safeCopy } from '../../../lib/clipboard.js';
import { timelineActionPillClassName, timelineAssistantRowClassName } from '../shared/rowStyles.js';

interface AssistantTextRowProps {
  id: string;
  model?: ModelSelection | null;
}

export function AssistantTextRow({ id, model }: AssistantTextRowProps) {
  const acc = useChatStore((s) => s.assistantTexts[id]);
  const lastUserPromptContent = useChatStore((s) => s.lastUserPromptContent);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const conversationId = useChatStore((s) => s.conversationId);
  const send = useChatStore((s) => s.send);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const settings = useSettingsStore((s) => s.settings);
  const permissions = selectEffectivePermissions(activeWorkspaceId, settings);

  const [copied, setCopied] = useState(false);
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (isProcessing) setPendingRegenerate(false);
  }, [isProcessing]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);

  if (!acc) return null;
  const cleaned = displayAssistantTurnText(acc.text);
  const streamingEmpty = cleaned.length === 0 && !acc.done;

  if (cleaned.length === 0 && acc.done) return null;

  const hasLastPrompt = typeof lastUserPromptContent === 'string' && lastUserPromptContent.length > 0;
  const canRegenerate =
    !isProcessing && hasLastPrompt && model !== null && conversationId !== null;

  const handleCopy = () => {
    void safeCopy(stripEmoji(cleaned), { context: 'assistant-row' }).then((ok) => {
      if (!ok || !mountedRef.current) return;
      setCopied(true);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        copyTimerRef.current = null;
        setCopied(false);
      }, 1200);
    });
  };

  const handleRegenerate = () => {
    if (!canRegenerate || !model || !lastUserPromptContent) return;
    setPendingRegenerate(true);
    void send(lastUserPromptContent, model, permissions);
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
        >
          {copied ? (
            <Check className="h-3 w-3 text-success" strokeWidth={2.25} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={2.25} />
          )}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button
          type="button"
          disabled={!canRegenerate}
          onClick={handleRegenerate}
          className={cn(
            timelineActionPillClassName,
            !canRegenerate && 'cursor-not-allowed opacity-40'
          )}
          title={canRegenerate ? 'Regenerate response' : 'Regenerate unavailable'}
          aria-label={canRegenerate ? 'Regenerate response' : 'Regenerate unavailable'}
        >
          <RefreshCcw
            className={cn('h-3 w-3', pendingRegenerate && 'animate-spin')}
            strokeWidth={2.25}
          />
          <span>Regenerate</span>
        </button>
      </div>
    </div>
  );
}
