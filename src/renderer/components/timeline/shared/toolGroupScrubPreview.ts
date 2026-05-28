/**
 * Streaming output text for tool-group hover scrub preview.
 */

import type { ToolName } from '@shared/types/tool.js';
import type { ToolGroupChild } from '../reducer/deriveRows.js';
import { editChildPath } from '../reducer/deriveRows/groupTools.js';

export function toolGroupStreamingBody(
  toolName: ToolName,
  items: ToolGroupChild[]
): string {
  const tail = items[items.length - 1];
  if (!tail) return '';

  if (toolName === 'edit') {
    const stream = tail.diffStream;
    if (stream?.hunks.length) {
      return stream.hunks
        .flatMap((h) => h.lines.map((l) => l.text))
        .join('\n');
    }
    const content =
      typeof tail.call?.args?.['newString'] === 'string'
        ? (tail.call.args['newString'] as string)
        : typeof tail.call?.args?.['content'] === 'string'
          ? (tail.call.args['content'] as string)
          : tail.partial && tail.call?.args
            ? JSON.stringify(tail.call.args, null, 2)
            : '';
    const path = editChildPath(tail);
    return path ? `${path}\n${content}` : content;
  }

  if (toolName === 'bash') {
    const cmd =
      typeof tail.call?.args?.['command'] === 'string'
        ? (tail.call.args['command'] as string)
        : '';
    const stream = tail.diffStream;
    if (stream?.hunks.length) {
      const diff = stream.hunks.flatMap((h) => h.lines.map((l) => l.text)).join('\n');
      return cmd ? `$ ${cmd}\n\n${diff}` : diff;
    }
    return cmd ? `$ ${cmd}` : '';
  }

  if (toolName === 'read' || toolName === 'search') {
    const query =
      typeof tail.call?.args?.['query'] === 'string'
        ? (tail.call.args['query'] as string)
        : typeof tail.call?.args?.['path'] === 'string'
          ? (tail.call.args['path'] as string)
          : '';
    return query;
  }

  if (tail.result?.output) return tail.result.output;
  if (tail.call?.args) return JSON.stringify(tail.call.args, null, 2);
  return '';
}

/** Slice streaming body by scrub ratio [0, 1]. */
export function scrubPreviewSlice(body: string, ratio: number): string {
  if (!body) return '';
  const clamped = Math.min(1, Math.max(0, ratio));
  const end = Math.max(1, Math.floor(body.length * clamped));
  return body.slice(0, end);
}
