/**
 * Collapsible phased-execution ledger artifact row. Expands into a structured
 * inspector (decisions + rationale, constraints, assumptions, attempted
 * approaches, code links, checkpoint reference) so a user can audit exactly
 * why the loop did what it did.
 */

import { useState } from 'react';
import type {
  AttemptedApproach,
  CheckpointMarkerRef,
  CodeLink,
  DoneCriterion,
  PlanStep
} from '@shared/types/phased.js';

interface PhaseLedgerRowProps {
  subtaskId: string;
  phase: string;
  summary: string;
  collapsedDefault?: boolean;
  discoveredConstraints?: string[];
  assumptions?: string[];
  decisions?: Array<{ decision: string; rationale: string }>;
  attemptedApproaches?: AttemptedApproach[];
  codeLinks?: CodeLink[];
  checkpointRef?: CheckpointMarkerRef;
  doneCriteria?: DoneCriterion[];
  acceptanceCommandCount?: number;
  planSteps?: PlanStep[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-1.5">
      <div className="vx-caption uppercase tracking-wide text-text-faint">{title}</div>
      <div className="mt-0.5 text-[11px] text-text-muted">{children}</div>
    </div>
  );
}

export function PhaseLedgerRow({
  subtaskId,
  phase,
  summary,
  collapsedDefault = true,
  discoveredConstraints,
  assumptions,
  decisions,
  attemptedApproaches,
  codeLinks,
  checkpointRef,
  doneCriteria,
  acceptanceCommandCount,
  planSteps
}: PhaseLedgerRowProps) {
  const [open, setOpen] = useState(!collapsedDefault);
  const hasStructured =
    (discoveredConstraints?.length ?? 0) > 0 ||
    (assumptions?.length ?? 0) > 0 ||
    (decisions?.length ?? 0) > 0 ||
    (attemptedApproaches?.length ?? 0) > 0 ||
    (codeLinks?.length ?? 0) > 0 ||
    checkpointRef !== undefined ||
    (doneCriteria?.length ?? 0) > 0 ||
    typeof acceptanceCommandCount === 'number' ||
    (planSteps?.length ?? 0) > 0;

  return (
    <div className="vyotiq-stepfade-once py-0.5 text-meta" data-row-kind="phase-ledger">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left vx-caption text-text-faint hover:text-text-muted"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="shrink-0 uppercase tracking-wide">{phase}</span>
        <span className="truncate">{subtaskId.slice(0, 8)}…</span>
      </button>
      {open ? (
        <div className="ml-2 mt-1 border-l border-border-subtle pl-3">
          {decisions && decisions.length > 0 ? (
            <Section title="Decisions">
              <ul className="space-y-0.5">
                {decisions.map((d, i) => (
                  <li key={i}>
                    <span className="text-text-default">{d.decision}</span>
                    {d.rationale ? <span className="text-text-faint"> — {d.rationale}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {doneCriteria && doneCriteria.length > 0 ? (
            <Section title="Done criteria">
              <ul className="space-y-0.5">
                {doneCriteria.map((c) => (
                  <li key={c.id}>
                    <span className="font-mono text-text-faint">{c.id}</span>
                    <span className="text-text-default"> — {c.description}</span>
                  </li>
                ))}
              </ul>
              {typeof acceptanceCommandCount === 'number' ? (
                <div className="mt-0.5 text-text-faint">
                  {acceptanceCommandCount} acceptance command
                  {acceptanceCommandCount === 1 ? '' : 's'} declared
                </div>
              ) : null}
            </Section>
          ) : null}
          {planSteps && planSteps.length > 0 ? (
            <Section title="Plan steps">
              <ul className="space-y-0.5">
                {planSteps.map((s) => (
                  <li key={`${s.subtaskId}-${s.order}`}>
                    <span className="text-text-default">
                      [{s.order}] {s.description}
                    </span>
                    <span className="text-text-faint">
                      {' '}
                      (criterion={s.doneCriterionId}; verify={s.verificationMethod})
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {attemptedApproaches && attemptedApproaches.length > 0 ? (
            <Section title="Attempted approaches">
              <ul className="space-y-0.5">
                {attemptedApproaches.map((a, i) => (
                  <li key={i}>
                    <span className="text-text-default">{a.approach}</span>
                    <span className="text-status-error"> — {a.whyFailed}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {discoveredConstraints && discoveredConstraints.length > 0 ? (
            <Section title="Constraints">
              <ul className="list-disc pl-4 space-y-0.5">
                {discoveredConstraints.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {assumptions && assumptions.length > 0 ? (
            <Section title="Assumptions / facts">
              <ul className="list-disc pl-4 space-y-0.5">
                {assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {codeLinks && codeLinks.length > 0 ? (
            <Section title="Code links">
              <ul className="space-y-0.5 font-mono">
                {codeLinks.map((l, i) => (
                  <li key={i}>
                    {l.file}
                    {typeof l.line === 'number' ? `:${l.line}` : ''}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {checkpointRef ? (
            <Section title="Checkpoint">
              <span className="font-mono">
                {checkpointRef.checkpointId.slice(0, 8)} · {checkpointRef.entryCount} entries
              </span>
            </Section>
          ) : null}
          {!hasStructured ? (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-faint">
              {summary}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
