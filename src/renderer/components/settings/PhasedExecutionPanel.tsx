import { useSettingsStore } from '../../store/useSettingsStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { resolvePhasedExecutionSettings } from '@shared/settings/phasedExecutionSettings.js';
import {
  MAX_TOTAL_ITERATIONS,
  PHASE_VERIFY_TIMEOUT_MAX_S,
  PHASE_VERIFY_TIMEOUT_MIN_S
} from '@shared/constants.js';
import { useToastStore } from '../../store/useToastStore.js';
import { ShellCaption, ShellSection } from '../ui/ShellSection.js';

const MODE_OPTIONS = [
  { value: 'auto', label: 'Auto (multi-step tasks only)' },
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never (legacy loop)' }
] as const;

export function PhasedExecutionPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const refresh = useSettingsStore((s) => s.refresh);
  const phased = resolvePhasedExecutionSettings(settings.ui);

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['phasedExecution']>) => {
    void vyotiq.settings
      .set({ ui: { phasedExecution: { ...settings.ui?.phasedExecution, ...patch } } })
      .then(() => refresh())
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save phased execution settings: ${msg}`, 'danger');
      });
  };

  return (
    <ShellSection title="Phased execution" className="mt-4">
      <ShellCaption>
        Gated subtask state machine with ledger, checkpoint markers, and host-run acceptance
        tests. Auto mode enables phased execution for multi-step build tasks only.
      </ShellCaption>
      <label className="mt-4 flex flex-col gap-1">
        <span className="vx-caption text-text-muted">Mode</span>
        <select
          className="max-w-md rounded-md border border-border-subtle bg-surface-1 px-2 py-1.5 text-sm"
          value={phased.mode}
          onChange={(e) =>
            apply({ mode: e.target.value as (typeof MODE_OPTIONS)[number]['value'] })
          }
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-4 flex flex-col gap-1">
        <span className="vx-caption text-text-muted">Per-subtask phase cycle cap</span>
        <input
          type="number"
          min={2}
          max={64}
          className="max-w-[8rem] rounded-md border border-border-subtle bg-surface-1 px-2 py-1.5 text-sm"
          value={phased.phaseCycleCap}
          onChange={(e) => apply({ phaseCycleCap: Number.parseInt(e.target.value, 10) })}
        />
        <ShellCaption>
          Loop-backs allowed per subtask before the escape hatch surfaces (2–64).
        </ShellCaption>
      </label>
      <label className="mt-4 flex flex-col gap-1">
        <span className="vx-caption text-text-muted">Max iterations (soft global cap)</span>
        <input
          type="number"
          min={2}
          max={MAX_TOTAL_ITERATIONS}
          className="max-w-[8rem] rounded-md border border-border-subtle bg-surface-1 px-2 py-1.5 text-sm"
          value={phased.maxIterations}
          onChange={(e) => apply({ maxIterations: Number.parseInt(e.target.value, 10) })}
        />
        <ShellCaption>
          Total orchestrator iterations before the run pauses for a human decision (max{' '}
          {MAX_TOTAL_ITERATIONS}).
        </ShellCaption>
      </label>
      <label className="mt-4 flex flex-col gap-1">
        <span className="vx-caption text-text-muted">Verify timeout (seconds)</span>
        <input
          type="number"
          min={PHASE_VERIFY_TIMEOUT_MIN_S}
          max={PHASE_VERIFY_TIMEOUT_MAX_S}
          className="max-w-[8rem] rounded-md border border-border-subtle bg-surface-1 px-2 py-1.5 text-sm"
          value={Math.round(phased.verifyTimeoutMs / 1000)}
          onChange={(e) =>
            apply({ verifyTimeoutSeconds: Number.parseInt(e.target.value, 10) })
          }
        />
        <ShellCaption>
          Per-command timeout when the host runs acceptance tests during VERIFY (
          {PHASE_VERIFY_TIMEOUT_MIN_S}–{PHASE_VERIFY_TIMEOUT_MAX_S}s).
        </ShellCaption>
      </label>
    </ShellSection>
  );
}
