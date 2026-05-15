/**
 * LiveStatusRow — single live telemetry line at the tail of the
 * timeline. Replaces the long-deleted static `Agent V is thinking…`
 * placeholder with content derived entirely from real signals.
 *
 * Visible for the entire duration of an in-flight run; never hides.
 * The label and icon mode-switch between three derived display
 * states so the row never lies about what's happening:
 *
 *   1. **Pre-first-byte (`connecting` → `awaiting-response`)**:
 *      driven by `run-status` events from the orchestrator. The
 *      `connecting` phase fires before the HTTP request gets
 *      headers back; `awaiting-response` flips in the moment the
 *      response is open but no token has arrived (see
 *      `ChatStreamRequest.onConnect` in `chatClient.ts`). Lets the
 *      user tell network latency apart from server-side think
 *      time.
 *
 *   2. **Streaming (`reasoning` / `streaming-text`)**: when an
 *      assistant-text or reasoning accumulator is actively growing
 *      (`!done` and non-empty), the row morphs into a tok/s
 *      readout calculated from `chars / 4 ≈ tokens` divided by
 *      wall-clock seconds since the first delta landed. Honest
 *      live throughput, not a heuristic guess. We deliberately do
 *      NOT hide: redundancy with the inline reasoning panel is
 *      worth it because the rate readout is the single highest-
 *      signal piece of info during streaming.
 *
 *   3. **Tool / delegate / verify / nudge / retry**: phase-specific
 *      labels and icons surface the orchestrator's own work.
 *
 * In all states a stopwatch ticks once per second against the
 * relevant anchor (status event `ts`, stream `startedAt`, or
 * `runStartedAt` as the pre-first-event fallback). The token-
 * usage pill renders once any `token-usage` frame has landed.
 *
 * No card, no border, no background. Stealth muted tone with the
 * shared `vyotiq-shimmer-text` utility for the breathing animation.
 */

import { useEffect, useState } from 'react';
import {
  Activity,
  BrainCircuit,
  Loader2,
  Radio,
  RefreshCcw,
  Scissors,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  type LucideIcon
} from 'lucide-react';
import type { TimelineEvent } from '@shared/types/chat.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { cn } from '../../../lib/cn.js';
import { shimmerText, shimmerStyle } from '../../../lib/shimmer.js';
import { formatTokenCount } from '../../../lib/formatTokens.js';

type RunStatusPhase = Extract<TimelineEvent, { kind: 'run-status' }>['phase'];

/**
 * Virtual phases the row can render that aren't part of the
 * orchestrator's `run-status` enum. Synthesized at the renderer side
 * from observable streaming state so the type union in `chat.ts`
 * stays clean of UI-only concerns.
 */
type DerivedPhase = RunStatusPhase | 'streaming-reasoning' | 'streaming-text';

/** Stopwatch tick interval. 1 s matches the reasoning-row stopwatch. */
const TICK_MS = 1000;

/** Default label when the orchestrator hasn't emitted a status yet. */
const DEFAULT_LABEL = 'Awaiting response…';

/**
 * Naive char-to-token approximation. Matches the BPE estimator used
 * by the composer pre-flight pill so the rate the user sees here is
 * directly comparable to the eventual provider-reported total. Real
 * BPE ratios sit in the 3–5 chars/token band for English, so 4 is
 * the conventional middle ground.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Floor on the elapsed-seconds denominator when computing tok/s.
 * Prevents an absurd >100 tok/s flash on the very first delta —
 * before the first second elapses we don't have enough data to
 * report a meaningful rate, so we hold at "≈ 0".
 */
const RATE_MIN_SECONDS = 0.5;

const ICONS: Record<DerivedPhase, LucideIcon> = {
  connecting: Radio,
  'awaiting-response': Loader2,
  'running-tool': Wrench,
  'preparing-turn': Loader2,
  delegating: Users,
  verifying: ShieldCheck,
  nudging: Sparkles,
  retrying: RefreshCcw,
  // Audit fix §2.3 — pre-iteration history shrink. Scissors icon
  // mirrors the "trimming" mental model (cutting off old turns to
  // fit the model's window).
  trimming: Scissors,
  'streaming-reasoning': BrainCircuit,
  'streaming-text': Activity
};

/** Phases whose icon should spin while live (continuous motion). */
const SPIN_PHASES: ReadonlySet<DerivedPhase> = new Set<DerivedPhase>([
  'awaiting-response',
  'preparing-turn',
  'retrying'
]);

interface LiveStreamSnapshot {
  kind: 'reasoning' | 'text';
  text: string;
  startedAt: number;
}

/**
 * Picks the most-recently-started open accumulator across the text
 * and reasoning maps. Reasoning takes precedence when its `startedAt`
 * is later than text's — guarantees that during a normal turn the
 * row reads `Reasoning…` while reasoning streams and switches to
 * `Streaming response` the moment the text accumulator opens (or
 * its startedAt becomes the newer of the two, which the auto-close
 * reducer guarantees by closing reasoning the moment text deltas
 * land for the same id).
 */
function pickLiveStream(
  assistantTexts: Record<string, { done: boolean; text: string; startedAt?: number }>,
  reasoningTexts: Record<string, { done: boolean; text: string; startedAt: number }>
): LiveStreamSnapshot | null {
  let best: LiveStreamSnapshot | null = null;
  for (const id in reasoningTexts) {
    const r = reasoningTexts[id]!;
    if (r.done || r.text.length === 0) continue;
    if (!best || r.startedAt > best.startedAt) {
      best = { kind: 'reasoning', text: r.text, startedAt: r.startedAt };
    }
  }
  for (const id in assistantTexts) {
    const t = assistantTexts[id]!;
    if (t.done || t.text.length === 0) continue;
    const startedAt = t.startedAt ?? Date.now();
    if (!best || startedAt >= best.startedAt) {
      best = { kind: 'text', text: t.text, startedAt };
    }
  }
  return best;
}

function hasRunningSubagent(
  subs: Record<string, { status: string }>
): boolean {
  for (const id in subs) {
    if (subs[id]!.status === 'running') return true;
  }
  return false;
}

/**
 * Streaming throughput in tokens-per-second, derived from accumulated
 * character count and wall-clock elapsed time. Returns `null` until
 * at least `RATE_MIN_SECONDS` have passed — the early-window flash
 * is meaningless and visually noisy.
 */
function liveTokensPerSecond(snap: LiveStreamSnapshot, now: number): number | null {
  const elapsedSec = (now - snap.startedAt) / 1000;
  if (elapsedSec < RATE_MIN_SECONDS) return null;
  const tokens = snap.text.length / CHARS_PER_TOKEN;
  return tokens / elapsedSec;
}

function formatRate(tokPerSec: number): string {
  if (tokPerSec >= 100) return `${Math.round(tokPerSec)} tok/s`;
  if (tokPerSec >= 10) return `${tokPerSec.toFixed(0)} tok/s`;
  return `${tokPerSec.toFixed(1)} tok/s`;
}

export function LiveStatusRow() {
  const isProcessing = useChatStore((s) => s.isProcessing);
  const runStartedAt = useChatStore((s) => s.runStartedAt);
  // Read the orchestrator-scoped run-status from a dedicated slot
  // rather than reverse-scanning `events`. Audit fix §3.2.1: status
  // events no longer churn the `events` array, so the previous
  // `latestRunStatus(events)` walk would have observed only stale
  // history. The reducer (`applyTimelineEvent`) parks the latest
  // orchestrator-scoped event here directly.
  const latest = useChatStore((s) => s.latestOrchestratorRunStatus);
  const assistantTexts = useChatStore((s) => s.assistantTexts);
  const reasoningTexts = useChatStore((s) => s.reasoningTexts);
  const subagents = useChatStore((s) => s.subagents);
  const orchestratorUsage = useChatStore((s) => s.orchestratorUsage);

  // A 1-Hz ticker drives both the stopwatch and the tok/s readout
  // WITHOUT forcing the rest of the timeline to re-render. Bare
  // counter; only this component observes it.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isProcessing) return;
    const h = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(h);
  }, [isProcessing]);

  if (!isProcessing) return null;

  const now = Date.now();
  const liveStream = pickLiveStream(assistantTexts, reasoningTexts);
  // While the orchestrator itself is streaming text/reasoning AND a
  // sub-agent is running, the sub-agent trace cards already carry
  // the liveness shimmer — hiding the orchestrator-level row avoids
  // redundant motion. When the orchestrator is in a non-streaming
  // phase (delegating, verifying, …) the row stays visible so the
  // user never loses the top-level status signal.
  if (liveStream && hasRunningSubagent(subagents)) return null;

  let phase: DerivedPhase;
  let label: string;
  let anchor: number;

  if (liveStream) {
    phase = liveStream.kind === 'reasoning' ? 'streaming-reasoning' : 'streaming-text';
    const rate = liveTokensPerSecond(liveStream, now);
    const base = liveStream.kind === 'reasoning' ? 'Reasoning' : 'Streaming response';
    label = rate !== null ? `${base} · ${formatRate(rate)}` : base;
    anchor = liveStream.startedAt;
  } else {
    phase = latest?.phase ?? 'awaiting-response';
    label = latest?.label ?? DEFAULT_LABEL;
    // Stopwatch anchors on the most recent event so the counter resets
    // at every phase transition — the user reads "how long have we
    // been stuck in THIS phase" rather than "how long has the whole
    // run lasted". `runStartedAt` is the fallback for the pre-first-
    // event window.
    anchor = latest?.ts ?? runStartedAt ?? now;
  }

  const Icon = ICONS[phase];
  const spinning = SPIN_PHASES.has(phase);
  const elapsedSeconds = Math.max(0, Math.floor((now - anchor) / 1000));

  const used = orchestratorUsage?.latest
    ? orchestratorUsage.latest.promptTokens + orchestratorUsage.latest.completionTokens
    : null;

  return (
    <div role="status" aria-live="polite" className="app-no-drag flex items-center gap-2 px-2 py-1 text-log">
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-text-muted',
          spinning && 'animate-spin'
        )}
        strokeWidth={2}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        <span
          className={shimmerText(true, 'italic text-text-muted')}
          style={shimmerStyle(`live-status:${phase}`)}
        >
          {label}
        </span>
        {elapsedSeconds > 0 && (
          <span className="ml-2 font-mono text-row text-text-faint">
            {elapsedSeconds}s
          </span>
        )}
        {used !== null && (
          <span className="ml-1 font-mono text-row text-text-faint">
            · {formatTokenCount(used)}
          </span>
        )}
      </span>
    </div>
  );
}
