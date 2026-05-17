/**
 * Settings → Context tab body.
 *
 * Visual contract: STRICTLY mirrors the Permissions tab — no
 * header, no nested cards, just rows from the shared
 * `RulesHeader` form starting at the top of the panel. The
 * per-workspace overrides section underneath uses the SAME
 * `WorkspaceOverridesSection` shape as the Permissions tab does.
 *
 * Per-workspace overrides are managed from the Inspector
 * slide-over (whose `RulesHeader` defaults to `'workspace'`
 * scope). This tab's job is the global default + showing what's
 * overridden.
 */

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { Spinner } from '../ui/Spinner.js';
import { RulesHeader } from '../contextInspector/RulesHeader.js';
import {
  DEFAULT_CONTEXT_SUMMARY_RULES,
  resolveContextSummaryRules,
  type ContextSummaryRules
} from '@shared/types/contextSummary.js';

export function ContextPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const settingsLoading = useSettingsStore((s) => s.loading);

  const [resolvedGlobal, setResolvedGlobal] = useState<ContextSummaryRules>(
    () => resolveContextSummaryRules(settings.contextSummary, undefined)
  );
  useEffect(() => {
    setResolvedGlobal(resolveContextSummaryRules(settings.contextSummary, undefined));
  }, [settings.contextSummary]);

  if (settingsLoading && !settings.permissions) {
    return (
      <div className="flex items-center gap-2 text-row text-text-muted">
        <Spinner /> Loading settings…
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <RulesHeader
        rules={resolvedGlobal}
        workspaceId={null}
        defaultScope="global"
      />
      <WorkspaceContextOverridesSection />
    </div>
  );
}

/**
 * Per-workspace overrides list. Visually matches
 * `WorkspaceOverridesSection` in `SettingsModal` exactly — same
 * `border-t border-border-subtle/40 pt-4` separator, same
 * `Eyebrow` header, same compact diff summary, same `Reset` ghost
 * button row. Hidden entirely when no workspace has any override.
 */
function WorkspaceContextOverridesSection() {
  const settings = useSettingsStore((s) => s.settings);
  const workspaces = useWorkspaceStore((s) => s.list);
  const updateRules = useContextSummaryStore((s) => s.updateRules);
  const showToast = useToastStore((s) => s.show);
  const overrideMap = settings.ui?.contextSummaryByWorkspace ?? {};
  const overridden = workspaces.filter(
    (w) => Object.keys(overrideMap[w.id] ?? {}).length > 0
  );
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
    <div className="mt-6 flex flex-col gap-2 border-t border-border-subtle/40 pt-4">
      <Eyebrow as="span" bold>
        Per-workspace overrides
      </Eyebrow>
      <div className="text-row text-text-muted">
        Workspaces below override the global defaults above. Toggling a
        rule from the Context Inspector while a workspace is active
        scopes the change to that workspace; reset to fall back to the
        global value.
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {overridden.map((w) => {
          const entry = overrideMap[w.id] ?? {};
          const diffs = describeOverrideDiff(entry);
          return (
            <li
              key={w.id}
              className="flex items-start justify-between gap-3 rounded-inner bg-surface-base/30 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-row text-text-primary">{w.label}</div>
                <div className="mt-0.5 text-meta text-text-muted" title={w.path}>
                  {diffs.length === 0
                    ? 'Override matches global defaults.'
                    : diffs.join(' · ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onReset(w.id)}
                title="Reset this workspace to the global default"
                className="inline-flex h-8 items-center gap-1.5 rounded-inner px-2.5 text-row text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.25} />
                <span>Reset</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Produce a short list of human strings describing only the fields a
 * workspace override actually pins. Mirrors the diff surface
 * `WorkspaceOverridesSection` uses in the permissions tab.
 */
function describeOverrideDiff(entry: Partial<ContextSummaryRules>): string[] {
  const out: string[] = [];
  const base = DEFAULT_CONTEXT_SUMMARY_RULES;
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

/**
 * Empty patch sentinel — clears the workspace's override slot via
 * the existing IPC. The settings store deep-merges, so we set
 * each supported field to `undefined` so the resolver falls back
 * to the global layer on read.
 */
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
