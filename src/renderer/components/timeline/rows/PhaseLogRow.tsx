/**
 * Persisted phase log line — subtle meta row in wire order (no divider chrome).
 * A gate decision shows a compact badge; clicking expands the full reason,
 * loop-back target, cited ledger entry, and host acceptance-test evidence.
 */

import { useState } from 'react';
import type { AcceptanceRunEvidence } from '@shared/types/phased.js';
import { cn } from '../../../lib/cn.js';
import {
  isPhaseHeadlineLabel,
  timelinePhaseHeadingClassName
} from '../shared/rowStyles.js';

interface PhaseLogRowProps {
  label: string;
  tooltip?: string;
  gateDecision?: {
    kind: 'passed' | 'looped_back' | 'blocked';
    reason: string;
    targetPhase?: string;
    citeLedgerEntryId?: string;
  };
  acceptanceEvidence?: AcceptanceRunEvidence[];
}

export function PhaseLogRow({ label, tooltip, gateDecision, acceptanceEvidence }: PhaseLogRowProps) {
  const [open, setOpen] = useState(false);
  const goldHeadline = isPhaseHeadlineLabel(label);
  const gateLabel =
    gateDecision?.kind === 'looped_back' && gateDecision.targetPhase
      ? `↩ ${gateDecision.targetPhase}`
      : gateDecision?.kind === 'passed'
        ? '✓'
        : gateDecision?.kind === 'blocked'
          ? '⊘'
          : null;
  const expandable =
    gateDecision !== undefined || (acceptanceEvidence?.length ?? 0) > 0;

  return (
    <div className="vyotiq-stepfade-once py-0.5 text-meta" data-row-kind="phase">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            goldHeadline ? timelinePhaseHeadingClassName(false) : 'vx-caption text-text-faint',
            tooltip && 'cursor-help'
          )}
          {...(tooltip ? { title: tooltip } : {})}
        >
          {label}
        </span>
        {gateLabel ? (
          <button
            type="button"
            disabled={!expandable}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={cn(
              'vx-caption',
              expandable && 'cursor-pointer',
              gateDecision?.kind === 'passed' && 'text-status-ok',
              gateDecision?.kind === 'looped_back' && 'text-status-warn',
              gateDecision?.kind === 'blocked' && 'text-status-error'
            )}
            title={gateDecision?.reason}
          >
            {gateLabel}
          </button>
        ) : null}
      </div>
      {open && gateDecision ? (
        <div className="ml-2 mt-1 border-l border-border-subtle pl-3 text-[11px] text-text-muted">
          <div>{gateDecision.reason}</div>
          {gateDecision.citeLedgerEntryId ? (
            <div className="mt-0.5 font-mono text-text-faint">
              cite: {gateDecision.citeLedgerEntryId.slice(0, 8)}…
            </div>
          ) : null}
          {acceptanceEvidence && acceptanceEvidence.length > 0 ? (
            <ul className="mt-1 space-y-0.5 font-mono">
              {acceptanceEvidence.map((ev, i) => (
                <li key={i} className={ev.exitCode === 0 && !ev.timedOut ? 'text-status-ok' : 'text-status-error'}>
                  {ev.timedOut ? 'timeout' : `exit ${ev.exitCode}`} · {ev.command}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
