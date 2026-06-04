/**
 * Subtitle resolver for the collapsed sub-agent row in the timeline.
 *
 * Picks the single most-informative one-line status from the live
 * snapshot so the user can see what each worker is actually doing
 * without expanding the trace.
 *
 * Hierarchy (top wins):
 *
 *   1. Failed / aborted / malformed terminal carrying a `message`
 *      → that message verbatim (caller paints the danger tone).
 *   2. **Live tool in flight** — either a `partialToolCallArgs` entry
 *      (model is still streaming the JSON args) OR the trailing
 *      `steps[]` entry whose `call` landed but whose `result` has not
 *      → rendered as a verb-led action (`Reading core/agent_repl.py`,
 *      `Editing src/foo.ts`, `Running bash · npm test`, …).
 *   3. **Streaming reasoning / text tail** — walk `iterationOrder`
 *      from newest to oldest and surface the trailing sentence of
 *      the first open accumulator (assistant text wins over reasoning
 *      on the same id because the assistant body is the user-facing
 *      stream). This is what fixes the screenshot-1 bug where the
 *      subtitle stayed stuck on `Awaiting first token from <model>…`
 *      even while reasoning was actively streaming.
 *   4. **`liveStatus.label`** — covers the legitimate `connecting`,
 *      `awaiting-response`, and `retrying` windows where nothing is
 *      yet streaming and no tool is in flight.
 *   5. **Settled with `<summary>`** — when `output` carries a parsed
 *      result envelope, surface `<summary> · done in Xs`.
 *   6. **Settled fallback** — quiet `done in Xs`.
 *
 * Pure — no module-level state, no allocations beyond the returned
 * string. Safe to call inline on every render of the collapsed row;
 * the cost is bounded by the number of open accumulators / in-flight
 * tool calls (typically ≤ 2) regardless of run length.
 */

import type { ToolName } from '@shared/types/tool.js';
import { parseResultEnvelope } from '@shared/text/resultPatterns.js';
import { formatDuration } from '../rows/RunCompleteRow.js';
import type { SubAgentSnapshot } from '../reducer/types.js';

/** Hard cap on the final string so the single-line clamp never has to truncate. */
const MAX_LEN = 140;
/** Window from which to extract the last sentence while a stream is open. */
const TAIL_LEN = 140;
/** Cap on the inlined bash command preview. */
const BASH_PREVIEW_LEN = 80;
/** Cap on free-form query previews (search / recall). */
const QUERY_PREVIEW_LEN = 60;

type ToolArgs = Record<string, unknown> | null;

/**
 * One verb per registered tool name. Kept exhaustive against
 * `RegisteredToolName` at the type level so adding a new tool that
 * forgets to register a label is a compile error rather than a silent
 * `Calling <toolName>` fallback at runtime.
 */
const TOOL_VERB: Record<ToolName, string> = {
  read: 'Reading',
  edit: 'Editing',
  delete: 'Deleting',
  ls: 'Listing',
  search: 'Searching',
  recall: 'Recalling',
  memory: 'Saving memory',
  bash: 'Running bash',
  report: 'Reporting',
  delegate: 'Spawning',
  finish: 'Finishing',
  ask_user: 'Asking',
  unknown: 'Calling tool'
};

function basenameOf(p: string): string {
  // Trailing separator? Pop it before slicing so `src/foo/` becomes `foo`.
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  // U+2026 horizontal ellipsis — matches the existing `quote()` helper
  // in DelegationWorkerOutline so the truncation glyph stays consistent.
  return `${s.slice(0, max - 1)}\u2026`;
}

function stringArg(args: ToolArgs, ...keys: string[]): string | null {
  if (!args) return null;
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * Render an in-flight tool call as a one-line verb-led label.
 * Returns `null` only when `name` is empty (defensive — should not
 * happen for a `tool-call` event but defends against malformed
 * partial-args entries).
 */
function formatToolAction(name: string, args: ToolArgs): string | null {
  if (!name) return null;
  // Workers cannot call `delegate`; never surface spawn copy on worker subtitles.
  if (name === 'delegate') return null;
  const verb = (TOOL_VERB as Record<string, string>)[name] ?? `Calling ${name}`;

  switch (name) {
    case 'read':
    case 'edit':
    case 'delete':
    case 'report': {
      const p = stringArg(args, 'path', 'filePath');
      return p ? `${verb} ${basenameOf(p)}` : verb;
    }
    case 'ls': {
      const p = stringArg(args, 'path');
      return p ? `${verb} ${p}` : verb;
    }
    case 'bash': {
      const cmd = stringArg(args, 'command');
      if (!cmd) return verb;
      const oneLine = cmd.replace(/\s+/g, ' ').trim();
      return `${verb} \u00b7 ${clip(oneLine, BASH_PREVIEW_LEN)}`;
    }
    case 'search': {
      const q = stringArg(args, 'query');
      return q ? `${verb} ${clip(q, QUERY_PREVIEW_LEN)}` : verb;
    }
    case 'recall': {
      const k = stringArg(args, 'key', 'query');
      return k ? `${verb} ${clip(k, QUERY_PREVIEW_LEN)}` : verb;
    }
    case 'memory':
      return verb;
    default:
      return verb;
  }
}

/**
 * Pick the freshest in-flight tool call for this worker. Prefers
 * `partialToolCallArgs` (the model is still streaming JSON args)
 * because that's the most recent signal; falls back to the trailing
 * `steps[]` entry whose `result` has not landed.
 */
function pickInflightToolAction(snap: SubAgentSnapshot): string | null {
  let latestPartial: {
    name?: string;
    parsed: Record<string, unknown> | null;
    ts: number;
  } | null = null;
  for (const id in snap.partialToolCallArgs) {
    const p = snap.partialToolCallArgs[id];
    if (!p) continue;
    if (!latestPartial || p.ts > latestPartial.ts) {
      latestPartial = { name: p.name, parsed: p.parsed, ts: p.ts };
    }
  }
  if (latestPartial && latestPartial.name) {
    return formatToolAction(latestPartial.name, latestPartial.parsed);
  }
  for (let i = snap.steps.length - 1; i >= 0; i--) {
    const step = snap.steps[i];
    if (!step) continue;
    if (step.call && !step.result) {
      const args = (step.call.args as ToolArgs) ?? null;
      return formatToolAction(step.call.name, args);
    }
  }
  return null;
}

/**
 * Pull the trailing sentence (or last clause) out of an open
 * streaming accumulator. Operates on a constant-size slice from the
 * end of the buffer so cost stays bounded for multi-thousand-token
 * reasoning streams.
 */
function tailOf(text: string): string | null {
  const window =
    text.length > TAIL_LEN ? text.slice(text.length - TAIL_LEN) : text;
  const collapsed = window.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  // Prefer the clause that follows the LAST sentence terminator inside
  // the window. Anchored at the right so partial sentences mid-stream
  // surface their newest clause, not an older completed one.
  const stripped = collapsed.replace(/[\s.!?]+$/u, '');
  const m = /[.!?]\s+([^.!?]+)$/u.exec(stripped);
  const candidate = m && m[1] ? m[1].trim() : collapsed;
  return candidate.length > 0 ? clip(candidate, MAX_LEN) : null;
}

function pickStreamingTail(snap: SubAgentSnapshot): string | null {
  // Newest iteration wins. Assistant text outranks reasoning on the
  // same id because the assistant body is the user-facing stream.
  for (let i = snap.iterationOrder.length - 1; i >= 0; i--) {
    const id = snap.iterationOrder[i];
    if (!id) continue;
    const text = snap.assistantTexts[id];
    if (text && !text.done && text.text.length > 0) {
      const t = tailOf(text.text);
      if (t) return t;
    }
    const reasoning = snap.reasoningTexts[id];
    if (reasoning && !reasoning.done && reasoning.text.length > 0) {
      const t = tailOf(reasoning.text);
      if (t) return t;
    }
  }
  // Defensive fallback for snapshots whose `iterationOrder` lags
  // behind the accumulator maps (transient one-frame races). Keep the
  // walk in insertion order so the result remains deterministic.
  for (const id in snap.assistantTexts) {
    const t = snap.assistantTexts[id];
    if (t && !t.done && t.text.length > 0) {
      const tail = tailOf(t.text);
      if (tail) return tail;
    }
  }
  for (const id in snap.reasoningTexts) {
    const r = snap.reasoningTexts[id];
    if (r && !r.done && r.text.length > 0) {
      const tail = tailOf(r.text);
      if (tail) return tail;
    }
  }
  return null;
}

/** Return value advertised to the collapsed row. `null` means "render nothing". */
export function resolveSubAgentSubtitle(snap: SubAgentSnapshot): string | null {
  const isLive = snap.status === 'pending' || snap.status === 'running';

  if (!isLive) {
    // Failed / aborted / malformed with a message wins — the existing
    // row chrome paints the danger tone.
    if (snap.message && snap.message.length > 0) {
      return clip(snap.message, MAX_LEN);
    }
    const elapsed = (snap.endedAt ?? Date.now()) - snap.startedAt;
    const durStr =
      Number.isFinite(elapsed) && elapsed > 0
        ? `done in ${formatDuration(elapsed)}`
        : null;
    const summary = snap.output ? parseResultEnvelope(snap.output).summary : '';
    if (summary) {
      return durStr
        ? clip(`${summary} \u00b7 ${durStr}`, MAX_LEN)
        : clip(summary, MAX_LEN);
    }
    return durStr;
  }

  // Live worker — prefer the freshest concrete activity signal.
  const tool = pickInflightToolAction(snap);
  if (tool) return clip(tool, MAX_LEN);

  const tail = pickStreamingTail(snap);
  if (tail) return tail;

  if (snap.liveStatus?.label) return clip(snap.liveStatus.label, MAX_LEN);
  return null;
}
