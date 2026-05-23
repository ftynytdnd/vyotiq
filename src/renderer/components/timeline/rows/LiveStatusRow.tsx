/**

 * LiveStatusRow — single live telemetry line at the tail of the

 * timeline. Replaces the long-deleted static `Agent V is thinking…`

 * placeholder with content derived entirely from real signals.

 *

 * Visible for the entire duration of an in-flight run; never hides.

 * During delegation, the row is clickable and scrolls to the latest

 * inline sub-agent trace row.

 */



import { useCallback, useEffect, useState } from 'react';

import {

  Activity,

  BrainCircuit,

  Loader2,

  Radio,

  RefreshCcw,

  ShieldCheck,

  Sparkles,

  Users,

  Wrench,

  type LucideIcon

} from 'lucide-react';

import type { TimelineEvent } from '@shared/types/chat.js';

import type { SubAgentSnapshot } from '../reducer/types.js';

import { useChatStore } from '../../../store/useChatStore.js';

import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';

import { aggregateSubAgentStatsSplit } from '../subagent/stats.js';

import {

  pickLatestSubagentId,

  scrollToSubagentRow

} from '../subagent/scrollToSubagentRow.js';

import { cn } from '../../../lib/cn.js';

import { shimmerText, shimmerStyle } from '../../../lib/shimmer.js';

import { formatTokenCount } from '../../../lib/formatTokens.js';

import { SurfaceShell, surfaceShellInnerClassName } from '../../ui/SurfaceShell.js';

import { timelineRowHeaderClassName } from '../shared/rowStyles.js';



type RunStatusPhase = Extract<TimelineEvent, { kind: 'run-status' }>['phase'];



type DerivedPhase = RunStatusPhase | 'streaming-reasoning' | 'streaming-text';



const TICK_MS = 1000;

const DEFAULT_LABEL = 'Awaiting response…';

const CHARS_PER_TOKEN = 4;

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

  'streaming-reasoning': BrainCircuit,

  'streaming-text': Activity

};



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



function formatDelegationLabel(

  baseLabel: string,

  subagents: Record<string, SubAgentSnapshot>,

  batchSinceTs?: number

): string {

  const workers = Object.values(subagents);

  const { batch, earlier } = aggregateSubAgentStatsSplit(workers, batchSinceTs);

  if (batch.total === 0 && earlier.total === 0) return baseLabel;

  const parts: string[] = [];

  if (batch.running > 0) parts.push(`${batch.running} running`);

  if (batch.done > 0) parts.push(`${batch.done} done (this batch)`);

  if (batch.failed > 0) parts.push(`${batch.failed} failed`);

  if (earlier.total > 0) parts.push(`${earlier.total} earlier`);

  return parts.length > 0 ? `${baseLabel} · ${parts.join(' · ')}` : baseLabel;

}



export function LiveStatusRow() {

  const isProcessing = useChatStore((s) => s.isProcessing);

  const runStartedAt = useChatStore((s) => s.runStartedAt);

  const latest = useChatStore((s) => s.latestOrchestratorRunStatus);

  const assistantTexts = useChatStore((s) => s.assistantTexts);

  const reasoningTexts = useChatStore((s) => s.reasoningTexts);

  const subagents = useChatStore((s) => s.subagents);

  const lastDelegationPhaseTs = useChatStore((s) => s.lastDelegationPhaseTs);

  const conversationId = useChatStore((s) => s.conversationId);

  const orchestratorUsage = useChatStore((s) => s.orchestratorUsage);

  const setExpanded = useTimelineUiStore((s) => s.setExpanded);



  const [, setTick] = useState(0);

  useEffect(() => {

    if (!isProcessing) return;

    const h = setInterval(() => setTick((n) => n + 1), TICK_MS);

    return () => clearInterval(h);

  }, [isProcessing]);



  const focusLatestSubagent = useCallback(() => {

    const latestId = pickLatestSubagentId(subagents);

    if (!latestId) return;

    if (conversationId) {

      setExpanded(conversationId, `sub:${latestId}`, true);

    }

    scrollToSubagentRow(latestId);

  }, [subagents, conversationId, setExpanded]);



  if (!isProcessing) return null;



  const now = Date.now();

  const liveStream = pickLiveStream(assistantTexts, reasoningTexts);



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

    if (phase === 'delegating') {

      label = formatDelegationLabel(label, subagents, lastDelegationPhaseTs);

    }

    anchor = latest?.ts ?? runStartedAt ?? now;

  }



  const Icon = ICONS[phase];

  const spinning = SPIN_PHASES.has(phase);

  const elapsedSeconds = Math.max(0, Math.floor((now - anchor) / 1000));

  const isDelegating = phase === 'delegating';



  const used = orchestratorUsage?.latest

    ? orchestratorUsage.latest.promptTokens + orchestratorUsage.latest.completionTokens

    : null;



  const inner = (

    <>

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

    </>

  );



  return (

    <SurfaceShell className={surfaceShellInnerClassName('compact')}>

      {isDelegating ? (

        <button

          type="button"

          role="status"

          aria-live="polite"

          aria-label="Scroll to latest sub-agent"

          onClick={focusLatestSubagent}

          className={cn(

            timelineRowHeaderClassName,

            'w-full cursor-pointer rounded-inner bg-transparent hover:bg-surface-hover/40'

          )}

        >

          {inner}

        </button>

      ) : (

        <div

          role="status"

          aria-live="polite"

          className={cn(timelineRowHeaderClassName, 'bg-transparent hover:bg-transparent')}

        >

          {inner}

        </div>

      )}

    </SurfaceShell>

  );

}


