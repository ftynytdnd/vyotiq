/**
 * Scrollable message list inside the Context Inspector.
 *
 * Layout matches `CheckpointsView`'s `RunsTab` / `FilesTab` pattern:
 * a small `Eyebrow` header above a max-height scroll surface using
 * the shared `scrollbar-stealth` utility. No card chrome around the
 * list itself — each row is a flat `border-b` row from `MessageRow`.
 */

import { Eyebrow } from '../ui/Eyebrow.js';
import { MessageRow } from './MessageRow.js';
import type { ContextInspectorMessage } from '@shared/types/contextSummary.js';

interface MessageListProps {
  messages: ReadonlyArray<ContextInspectorMessage>;
  conversationId: string;
}

export function MessageList({ messages, conversationId }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="text-row text-text-muted">
        The orchestrator hasn't accumulated any messages yet.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow as="span" bold>
          Messages
        </Eyebrow>
        <span className="text-meta text-text-faint">
          {messages.length} {messages.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      <ul className="scrollbar-stealth flex max-h-[44vh] flex-col overflow-y-auto pr-1">
        {messages.map((m) => (
          <MessageRow key={m.messageId} message={m} conversationId={conversationId} />
        ))}
      </ul>
    </div>
  );
}
