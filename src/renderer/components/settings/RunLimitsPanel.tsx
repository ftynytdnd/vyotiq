import { useSettingsStore } from '../../store/useSettingsStore.js';
import { persistSettingsPatch } from '../../lib/persistSettingsPatch.js';
import {
  DEFAULT_RUN_TOKEN_BUDGET_MAX,
  DEFAULT_RUN_WALL_CLOCK_BUDGET_MS,
  resolveAgentBehaviorSettings
} from '@shared/settings/agentBehaviorSettings.js';
import { DEFAULT_MAX_TOTAL_ITERATIONS } from '@shared/constants.js';
import { useToastStore } from '../../store/useToastStore.js';
import { ShellCaption, ShellFieldLabel, ShellSection } from '../ui/ShellSection.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

export function RunLimitsPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const agentBehavior = resolveAgentBehaviorSettings(settings.ui);

  const applyAgentBehavior = (
    patch: Partial<NonNullable<typeof settings.ui>['agentBehavior']>
  ) => {
    void persistSettingsPatch({
      ui: { agentBehavior: { ...settings.ui?.agentBehavior, ...patch } }
    }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save run limit settings: ${msg}`, 'danger');
      });
  };

  const applyBudget = (
    patch: Partial<NonNullable<NonNullable<typeof settings.ui>['agentBehavior']>['runTokenBudget']>
  ) => {
    applyAgentBehavior({
      runTokenBudget: { ...settings.ui?.agentBehavior?.runTokenBudget, ...patch }
    });
  };

  const applyWallClock = (
    patch: Partial<
      NonNullable<NonNullable<typeof settings.ui>['agentBehavior']>['runWallClockBudget']
    >
  ) => {
    applyAgentBehavior({
      runWallClockBudget: { ...settings.ui?.agentBehavior?.runWallClockBudget, ...patch }
    });
  };

  return (
    <ShellSection>
      <ShellCaption>
        Optional guardrails for long agent runs. Token and wall-clock budgets halt the
        orchestrator when a run exceeds the configured ceilings. The iteration limit
        caps tool rounds before a wrap-up synthesis turn.
      </ShellCaption>
      <div className="mt-3 flex flex-col gap-1">
        <ShellFieldLabel htmlFor="run-iteration-limit-max">
          Max orchestrator iterations per run
        </ShellFieldLabel>
        <input
          id="run-iteration-limit-max"
          type="number"
          min={8}
          max={200}
          step={1}
          className="vx-input w-full max-w-xs font-mono text-row"
          value={agentBehavior.runIterationLimit.maxTotalIterations}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            applyAgentBehavior({
              runIterationLimit: {
                maxTotalIterations: Number.isFinite(parsed)
                  ? parsed
                  : DEFAULT_MAX_TOTAL_ITERATIONS
              }
            });
          }}
        />
      </div>
      <SettingsSwitchRow
        label="Per-run token budget"
        description="Stop the run when cumulative total tokens exceed the ceiling below."
        value={agentBehavior.runTokenBudget.enabled}
        onChange={(v) => applyBudget({ enabled: v })}
      />
      <div className="mt-3 flex flex-col gap-1">
        <ShellFieldLabel htmlFor="run-token-budget-max">Max total tokens per run</ShellFieldLabel>
        <input
          id="run-token-budget-max"
          type="number"
          min={10_000}
          max={50_000_000}
          step={10_000}
          disabled={!agentBehavior.runTokenBudget.enabled}
          className="vx-input w-full max-w-xs font-mono text-row disabled:opacity-50"
          value={agentBehavior.runTokenBudget.maxTotalTokens}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            applyBudget({
              maxTotalTokens: Number.isFinite(parsed) ? parsed : DEFAULT_RUN_TOKEN_BUDGET_MAX
            });
          }}
        />
      </div>
      <SettingsSwitchRow
        label="Per-run wall-clock budget"
        description="Stop the run after the maximum duration below (minutes)."
        value={agentBehavior.runWallClockBudget.enabled}
        onChange={(v) => applyWallClock({ enabled: v })}
      />
      <div className="mt-3 flex flex-col gap-1">
        <ShellFieldLabel htmlFor="run-wall-clock-budget-max">Max duration (minutes)</ShellFieldLabel>
        <input
          id="run-wall-clock-budget-max"
          type="number"
          min={1}
          max={24 * 60}
          step={1}
          disabled={!agentBehavior.runWallClockBudget.enabled}
          className="vx-input w-full max-w-xs font-mono text-row disabled:opacity-50"
          value={Math.round(agentBehavior.runWallClockBudget.maxDurationMs / 60_000)}
          onChange={(e) => {
            const minutes = Number(e.target.value);
            applyWallClock({
              maxDurationMs: Number.isFinite(minutes)
                ? Math.round(minutes * 60_000)
                : DEFAULT_RUN_WALL_CLOCK_BUDGET_MS
            });
          }}
        />
      </div>
    </ShellSection>
  );
}
