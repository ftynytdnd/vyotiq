/**
 * Scrollable message list inside the Context Inspector.
 *
 * Layout matches `CheckpointsView`'s `RunsTab` / `FilesTab` pattern:
 * a small `Eyebrow` header above a max-height scroll surface using
 * the shared `scrollbar-stealth` utility. No card chrome around the
 * list itself — each row is a compact `SurfaceShell` from `MessageRow`.
 */

import { cn } from '../../lib/cn.js';
import { chromeListEmptyClassName, surfaceListClassName } from '../ui/SurfaceShell.js';
import { MessageRow } from './MessageRow.js';
import type { ContextInspectorMessage } from '@shared/types/contextSummary.js';

interface MessageListProps {
  messages: ReadonlyArray<ContextInspectorMessage>;
  conversationId: string;
}

export function MessageList({ messages, conversationId }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className={chromeListEmptyClassName}>
        The orchestrator hasn&apos;t accumulated any messages yet.
      </div>
    );
  }
  return (
    <section className="vx-section">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="vx-section-head mb-0">Messages</h3>
        <span className="vx-caption">
          {messages.length} {messages.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      <ul className={cn('scrollbar-stealth flex max-h-[min(45vh,28rem)] flex-col overflow-y-auto pr-1', surfaceListClassName)}>
        {messages.map((m) => (
          <MessageRow key={m.messageId} message={m} conversationId={conversationId} />
        ))}
      </ul>
    </section>
  );
}
