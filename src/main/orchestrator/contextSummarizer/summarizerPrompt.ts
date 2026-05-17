/**
 * Summarizer prompt body assembly.
 *
 * The summarizer LLM call is shaped as:
 *
 *   - SYSTEM message: rendered by `harnessLoader.buildSummarizerSystemPrompt`
 *     (Prime Directives + bundled or workspace-override
 *     `05-context-summarizer.md` + runtime limits).
 *   - USER message: built here. One XML envelope wrapping the
 *     messages-to-compress, structured so the harness §A taxonomy
 *     parses unambiguously, plus a `<task>` anchor (the original
 *     user prompt) and a `<run_state>` snapshot.
 *
 * Pure function. Does NOT touch the filesystem — the workspace
 * override probe lives in `harnessLoader.resolveSummarizerBody`.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { wrapXml, escapeXmlAttr } from '../envelope/index.js';
import { escapeXmlBody } from '../envelope/escapeXmlBody.js';
import {
  classifyMessage,
  type MessageWindowPartition
} from './messageWindow.js';

/**
 * Render the summarizer's USER message body.
 *
 * Layout:
 *
 *   <task>
 *   {originalPrompt}
 *   </task>
 *
 *   <run_state>{runStateSnapshot}</run_state>
 *
 *   <messages>
 *     <message kind="user" id="m07">…</message>
 *     <message kind="assistant-tool-call" id="m08">
 *       <tool_calls>
 *         <call id="c0" name="read">{"path":"src/foo.ts"}</call>
 *       </tool_calls>
 *     </message>
 *     <message kind="tool-result" call_id="c0">…</message>
 *     …
 *   </messages>
 *
 * The `id` attribute on each `<message>` is the stable
 * `messageWindow.identify` id — the harness §A taxonomy references
 * these so the model can refer back to specific messages in its
 * "Files touched" / "Sub-agent verdicts" sections.
 *
 * Dropped messages (`partition.dropped` overlapping the
 * summarizable range) are intentionally NOT included in the body;
 * the wrapper `streamSummary` decides whether to surface them as
 * `[user-dropped: kind, ~N chars]` placeholder lines based on
 * `rules.droppedMarkerStyle`. That keeps THIS function pure and
 * single-responsibility.
 *
 * All user-supplied strings are XML-body-escaped so a hostile
 * tool-result like `</messages>` cannot break out of the envelope
 * and inject pseudo-instructions into the summarizer (Prime
 * Directives §6 boundary rule).
 */
export function buildSummarizerUserMessage(opts: {
  messages: ReadonlyArray<ChatMessage>;
  partition: MessageWindowPartition;
  /** Original user prompt — anchors the `<task>` block. */
  originalPrompt: string;
  /** Pre-rendered `<run_state>` block from the orchestrator's
   *  loop; passed straight through. Optional because the very
   *  first iteration may not have built one yet. */
  runStateXml?: string;
  /** Synthetic placeholder lines to append for dropped messages.
   *  When `droppedMarkerStyle === 'omit'`, pass `[]`. */
  droppedPlaceholders: ReadonlyArray<{
    id: string;
    kind: string;
    charCount: number;
  }>;
}): string {
  const taskBlock = wrapXml('task', opts.originalPrompt, undefined, {
    escape: true
  });
  const runStateBlock = opts.runStateXml ?? '';
  const messageBodies: string[] = [];
  for (const idx of opts.partition.summarizable) {
    const msg = opts.messages[idx];
    if (!msg) continue;
    messageBodies.push(renderMessage(msg, opts.partition.ids[idx]!));
  }
  if (opts.droppedPlaceholders.length > 0) {
    const droppedLines = opts.droppedPlaceholders
      .map((d) =>
        `<dropped id="${escapeXmlAttr(d.id)}" kind="${escapeXmlAttr(d.kind)}" approx_chars="${d.charCount}" />`
      )
      .join('\n');
    messageBodies.push(droppedLines);
  }
  const messagesBlock = wrapXml('messages', messageBodies.join('\n'));
  return [taskBlock, runStateBlock, messagesBlock]
    .filter((s) => s.length > 0)
    .join('\n\n');
}

/**
 * Render a single `<message>` element. Handles each role +
 * tool-calls combination so the harness §A taxonomy parses
 * uniformly. The body is XML-body-escaped (NOT attribute-escaped)
 * so the model still sees newlines and indentation as the user
 * authored them.
 */
function renderMessage(msg: ChatMessage, id: string): string {
  const kind = classifyMessage(msg);
  const role = msg.role;
  const content = msg.content ?? '';
  const safeContent = escapeXmlBody(content);
  const idAttr = escapeXmlAttr(id);

  if (msg.role === 'tool') {
    const callId = escapeXmlAttr(msg.tool_call_id ?? '');
    const nameAttr = msg.name
      ? ` name="${escapeXmlAttr(msg.name)}"`
      : '';
    return (
      `<message kind="${kind}" id="${idAttr}" call_id="${callId}"${nameAttr}>` +
      `\n${safeContent}\n` +
      `</message>`
    );
  }

  if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    const calls = msg.tool_calls
      .map(
        (tc) =>
          `<call id="${escapeXmlAttr(tc.id)}" name="${escapeXmlAttr(tc.function.name)}">` +
          escapeXmlBody(tc.function.arguments) +
          `</call>`
      )
      .join('\n');
    const textBody = safeContent.length > 0 ? `\n${safeContent}\n` : '\n';
    return (
      `<message kind="${kind}" id="${idAttr}" role="${role}">` +
      textBody +
      `<tool_calls>\n${calls}\n</tool_calls>\n` +
      `</message>`
    );
  }

  // Plain user / assistant / system content.
  const reasoning =
    typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0
      ? `\n<reasoning>\n${escapeXmlBody(msg.reasoning_content)}\n</reasoning>`
      : '';
  return (
    `<message kind="${kind}" id="${idAttr}" role="${role}">` +
    `\n${safeContent}` +
    reasoning +
    `\n</message>`
  );
}

/**
 * Wrap the final summarized text into the `<context_summary>`
 * envelope that the orchestrator splices into its `messages[]` as
 * a `role:'system'` entry. Pure helper; the actual splice lives in
 * `applySummary.ts`.
 *
 * The wrapping carries a `summary_id` attribute so a future
 * inspector pass can walk the orchestrator's persisted context
 * and surface every prior summary by id without parsing the body.
 */
export function wrapAsContextSummaryEnvelope(opts: {
  summaryId: string;
  finalText: string;
}): string {
  const idAttr = escapeXmlAttr(opts.summaryId);
  return wrapXml('context_summary', opts.finalText, { summary_id: idAttr });
}
