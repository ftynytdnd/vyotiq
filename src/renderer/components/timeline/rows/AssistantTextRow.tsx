/**
 * Streams the assistant's output as rendered markdown (GFM + syntax-highlighted
 * code fences). Reads from the chat-store accumulator so reruns and re-mounts
 * don't lose the buffered text.
 *
 * The model sometimes emits internal `<delegate />` XML scaffolding around
 * its user-facing answer; `stripDelegatesForDisplay` removes it before the
 * text reaches the markdown parser.
 */

import { useEffect, useRef, useState } from 'react';
import { Copy, Check, RefreshCcw } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { stripEmoji } from '@shared/text/emoji.js';
import { useChatStore } from '../../../store/useChatStore.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { stripDelegatesForDisplay } from '../../../lib/text.js';
import { MarkdownBody } from '../markdown/MarkdownBody.js';
import { cn } from '../../../lib/cn.js';
import { safeCopy } from '../../../lib/clipboard.js';
import { SurfaceShell, surfaceShellInnerClassName } from '../../ui/SurfaceShell.js';
import { timelineActionPillClassName } from '../shared/rowStyles.js';

interface AssistantTextRowProps {
  id: string;
  model?: ModelSelection | null;
}

export function AssistantTextRow({ id, model }: AssistantTextRowProps) {
  const acc = useChatStore((s) => s.assistantTexts[id]);
  // Audit fix C2: read the most-recent prompt from the reducer-
  // maintained mirror field (O(1) lookup) instead of reverse-walking
  // the events array on every render.
  const lastUserPromptContent = useChatStore((s) => s.lastUserPromptContent);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const conversationId = useChatStore((s) => s.conversationId);
  const send = useChatStore((s) => s.send);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const settings = useSettingsStore((s) => s.settings);
  const permissions = selectEffectivePermissions(activeWorkspaceId, settings);

  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

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
  const cleaned = stripDelegatesForDisplay(acc.text);
  if (cleaned.length === 0) return null;

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
    void send(lastUserPromptContent, model, permissions);
  };

  return (
    <div className="group flex flex-col gap-1">
      <SurfaceShell className={surfaceShellInnerClassName('content')}>
        <MarkdownBody text={cleaned} />
      </SurfaceShell>
      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
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
        >
          <RefreshCcw className="h-3 w-3" strokeWidth={2.25} />
          <span>Regenerate</span>
        </button>
      </div>
    </div>
  );
}
