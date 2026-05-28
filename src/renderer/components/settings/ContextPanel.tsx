/**
 * Settings → Context tab body.
 *
 * Visual contract: mirrors Permissions tab — Vyotiq UI sections with
 * left-rail headings, row dividers, and override rows. Per-workspace
 * overrides use the same `ShellSection` + `vx-override` shape as
 * Settings → Permissions.
 */

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { TOKEN_BUDGET_WARNING_DEFAULT_TOKENS } from '@shared/constants.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import {
  selectEffectiveTokenBudgetWarning,
  useSettingsStore
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { TextField } from '../ui/TextField.js';
import {
  ShellCaption,
  ShellRow,
  ShellRowSplit,
  ShellSection,
  ShellStack
} from '../ui/ShellSection.js';
import { chromeGhostRowButtonClassName } from '../ui/SurfaceShell.js';
import { RulesHeader } from '../contextInspector/RulesHeader.js';
import {
  DEFAULT_CONTEXT_SUMMARY_RULES,
  resolveContextSummaryRules,
  type ContextSummaryRules
} from '@shared/types/contextSummary.js';
import type { AppSettings } from '@shared/types/ipc.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

export function ContextPanel({ embedded: _embedded = false }: { embedded?: boolean }) {
  const settings = useSettingsStore((s) => s.settings);
  const settingsLoading = useSettingsStore((s) => s.loading);
  const setTokenBudgetWarningTokens = useSettingsStore((s) => s.setTokenBudgetWarningTokens);

  const [resolvedGlobal, setResolvedGlobal] = useState<ContextSummaryRules>(
    () => resolveContextSummaryRules(settings.contextSummary, undefined)
  );
  useEffect(() => {
    setResolvedGlobal(resolveContextSummaryRules(settings.contextSummary, undefined));
  }, [settings.contextSummary]);

  const persistedBudgetK = Math.round(
    (settings.ui?.tokenBudgetWarningTokens ?? TOKEN_BUDGET_WARNING_DEFAULT_TOKENS) / 1000
  );
  const [budgetDraftK, setBudgetDraftK] = useState(String(persistedBudgetK));
  const budgetDirty = budgetDraftK !== String(persistedBudgetK);

  useEffect(() => {
    setBudgetDraftK(String(persistedBudgetK));
  }, [persistedBudgetK]);

  const onSaveBudgetWarning = async () => {
    const parsed = Number.parseInt(budgetDraftK, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      useToastStore.getState().show('Enter a positive token count (in thousands).', 'danger');
      return;
    }
    try {
      await setTokenBudgetWarningTokens(parsed * 1000);
      useToastStore.getState().show('Token budget warning threshold saved.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Save failed: ${msg}`, 'danger');
    }
  };

  if (settingsLoading && !settings.permissions) {
    return (
      <div className="flex items-center gap-2 vx-caption">
        <LoadingHint message="Loading settings…" className="py-4" />
      </div>
    );
  }

  return (
    <ShellStack>
      <ShellSection title="Context summary">
        <RulesHeader
          rules={resolvedGlobal}
          workspaceId={null}
          defaultScope="global"
        />
      </ShellSection>
      <ShellSection title="Timeline">
        <ShellRow>
          <ShellRowSplit
            main={
              <>
                <div className="vx-row-label">Token budget warning (k)</div>
                <p className="vx-row-desc">
                  Show a timeline warning when estimated context exceeds this threshold.
                </p>
              </>
            }
            control={
              <div className="flex flex-wrap items-center gap-2">
                <TextField
                  type="number"
                  min={1}
                  value={budgetDraftK}
                  placeholder={String(TOKEN_BUDGET_WARNING_DEFAULT_TOKENS / 1000)}
                  appearance="boxed"
                  size="sm"
                  onChange={(e) => setBudgetDraftK(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void onSaveBudgetWarning();
                    }
                  }}
                  className="w-16 font-mono text-right"
                />
                <Button variant="primary" disabled={!budgetDirty} onClick={() => void onSaveBudgetWarning()}>
                  Save
                </Button>
              </div>
            }
          />
        </ShellRow>
      </ShellSection>
      <WorkspaceContextOverridesSection settings={settings} />
    </ShellStack>
  );
}

function WorkspaceContextOverridesSection({ settings }: { settings: AppSettings }) {
  const workspaces = useWorkspaceStore((s) => s.list);
  const updateRules = useContextSummaryStore((s) => s.updateRules);
  const showToast = useToastStore((s) => s.show);
  const overrideMap = settings.ui?.contextSummaryByWorkspace ?? {};
  const budgetOverrideMap = settings.ui?.tokenBudgetWarningByWorkspace ?? {};
  const overridden = workspaces.filter((w) => {
    const ctx = Object.keys(overrideMap[w.id] ?? {}).length > 0;
    const budget = w.id in budgetOverrideMap;
    return ctx || budget;
  });
  if (overridden.length === 0) return null;

  const onReset = async (workspaceId: string) => {
    try {
      await updateRules('workspace', emptyPatch(), workspaceId);
      showToast('Workspace context rules reset to global defaults.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Reset failed: ${msg}`, 'danger');
    }
  };

  return (
    <ShellSection title="Per-workspace overrides">
      <ShellCaption className="mb-3">
        Workspaces below override the global defaults above. Toggling a rule from the Context
        Inspector while a workspace is active scopes the change to that workspace; reset to fall
        back to the global value.
      </ShellCaption>
      {overridden.map((w) => {
        const entry = overrideMap[w.id] ?? {};
        const diffs = describeOverrideDiff(entry, settings, w.id);
        return (
          <ShellRow key={w.id}>
            <div className="vx-override">
              <div className="min-w-0">
                <div className="vx-row-label">{w.label}</div>
                <p className="vx-row-desc" title={w.path}>
                  {diffs.length === 0
                    ? 'Override matches global defaults.'
                    : diffs.join(' · ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onReset(w.id)}
                title="Reset this workspace to the global default"
                className={chromeGhostRowButtonClassName}
              >
                <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                Reset
              </button>
            </div>
          </ShellRow>
        );
      })}
    </ShellSection>
  );
}

function describeOverrideDiff(
  entry: Partial<ContextSummaryRules>,
  settings: AppSettings,
  workspaceId: string
): string[] {
  const out: string[] = [];
  const base = DEFAULT_CONTEXT_SUMMARY_RULES;
  const globalBudget = selectEffectiveTokenBudgetWarning(settings, null);
  const wsBudget = settings.ui?.tokenBudgetWarningByWorkspace?.[workspaceId];
  if (typeof wsBudget === 'number' && wsBudget > 0 && wsBudget !== globalBudget) {
    out.push(`Budget warning: ${Math.round(wsBudget / 1000)}k`);
  }
  if (entry.enabled !== undefined && entry.enabled !== base.enabled) {
    out.push(`enabled: ${entry.enabled ? 'on' : 'off'}`);
  }
  if (
    entry.autoTriggerRatio !== undefined &&
    entry.autoTriggerRatio !== base.autoTriggerRatio
  ) {
    out.push(`trigger: ${Math.round(entry.autoTriggerRatio * 100)}%`);
  }
  if (
    entry.keepRecentTurns !== undefined &&
    entry.keepRecentTurns !== base.keepRecentTurns
  ) {
    out.push(`keep ${entry.keepRecentTurns} turns`);
  }
  if (
    entry.minMessagesToSummarize !== undefined &&
    entry.minMessagesToSummarize !== base.minMessagesToSummarize
  ) {
    out.push(`min ${entry.minMessagesToSummarize} msgs`);
  }
  if (entry.maxRetries !== undefined && entry.maxRetries !== base.maxRetries) {
    out.push(`retries ${entry.maxRetries}`);
  }
  if (
    entry.preserveUserPromptsAlways !== undefined &&
    entry.preserveUserPromptsAlways !== base.preserveUserPromptsAlways
  ) {
    out.push(
      `preserve user prompts: ${entry.preserveUserPromptsAlways ? 'on' : 'off'}`
    );
  }
  if (
    entry.preserveFirstSystem !== undefined &&
    entry.preserveFirstSystem !== base.preserveFirstSystem
  ) {
    out.push(
      `preserve system slot: ${entry.preserveFirstSystem ? 'on' : 'off'}`
    );
  }
  if (
    entry.droppedMarkerStyle !== undefined &&
    entry.droppedMarkerStyle !== base.droppedMarkerStyle
  ) {
    out.push(`dropped marker: ${entry.droppedMarkerStyle}`);
  }
  if (entry.summarizerSelection) {
    out.push(`model: ${entry.summarizerSelection.modelId}`);
  } else if ('summarizerSelection' in entry) {
    out.push('model: run model');
  }
  if (entry.perKindPolicy) {
    const changed = Object.entries(entry.perKindPolicy).filter(
      ([k, v]) =>
        v !== base.perKindPolicy[k as keyof typeof base.perKindPolicy]
    );
    if (changed.length > 0) {
      out.push(`${changed.length} kind policies`);
    }
  }
  return out;
}

function emptyPatch(): Partial<ContextSummaryRules> {
  return {
    enabled: undefined,
    autoTriggerRatio: undefined,
    keepRecentTurns: undefined,
    preserveUserPromptsAlways: undefined,
    preserveFirstSystem: undefined,
    minMessagesToSummarize: undefined,
    maxRetries: undefined,
    summarizerSelection: undefined,
    perKindPolicy: undefined,
    droppedMarkerStyle: undefined
  } as unknown as Partial<ContextSummaryRules>;
}
