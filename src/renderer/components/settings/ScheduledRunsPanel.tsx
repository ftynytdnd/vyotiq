/**
 * Settings → Agent behavior → Scheduled runs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScheduledRun } from '@shared/types/scheduledRun.js';
import { vyotiq } from '../../lib/ipc.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import {
  ShellSection,
  ShellStack,
  ShellCaption,
  ShellRow,
  ShellFieldLabel
} from '../ui/ShellSection.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';
import { TextField } from '../ui/TextField.js';
import { Button } from '../ui/Button.js';

const INTERVAL_PRESETS = [
  { minutes: 5, label: 'Every 5 minutes' },
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Hourly' },
  { minutes: 120, label: 'Every 2 hours' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 1440, label: 'Daily' }
] as const;

function persistRun(run: ScheduledRun, refresh: () => Promise<void>): void {
  void vyotiq.scheduledRuns.upsert(run).then(refresh);
}

interface ScheduledRunCardProps {
  run: ScheduledRun;
  workspaces: Array<{ id: string; label: string }>;
  conversations: Array<{ id: string; title: string; workspaceId: string }>;
  modelOptions: Array<{ value: string; label: string }>;
  onChange: (run: ScheduledRun) => void;
  onPersist: (run: ScheduledRun) => void;
  onDelete: () => void;
}

function ScheduledRunCard({
  run,
  workspaces,
  conversations,
  modelOptions,
  onChange,
  onPersist,
  onDelete
}: ScheduledRunCardProps) {
  const workspaceConversations = conversations.filter((c) => c.workspaceId === run.workspaceId);

  const modelValue = `${run.providerId}\u0000${run.modelId}`;
  const resolvedModelValue = modelOptions.some((o) => o.value === modelValue) ? modelValue : '';

  return (
    <div className="vx-stack gap-3 rounded-inner border border-border-subtle/25 p-3">
      <SettingsSwitchRow
        label={run.label.trim().length > 0 ? run.label : 'Scheduled run'}
        description={
          run.enabled
            ? `Next tick when due · ${run.providerId} / ${run.modelId}`
            : 'Disabled — enable to dispatch on interval while Vyotiq is open'
        }
        value={run.enabled}
        onChange={(enabled) => {
          const next = { ...run, enabled };
          onChange(next);
          onPersist(next);
        }}
      />

      <ShellRow>
        <ShellFieldLabel htmlFor={`schedule-label-${run.id}`}>Label</ShellFieldLabel>
        <TextField
          id={`schedule-label-${run.id}`}
          value={run.label}
          onChange={(e) => onChange({ ...run, label: e.target.value })}
          onBlur={(e) => onPersist({ ...run, label: e.target.value })}
        />
      </ShellRow>

      <ShellRow>
        <ShellFieldLabel htmlFor={`schedule-workspace-${run.id}`}>Workspace</ShellFieldLabel>
        <select
          id={`schedule-workspace-${run.id}`}
          className="vx-select w-full"
          value={run.workspaceId}
          onChange={(e) => {
            const workspaceId = e.target.value;
            const firstConv = conversations.find((c) => c.workspaceId === workspaceId);
            const next: ScheduledRun = {
              ...run,
              workspaceId,
              conversationId: firstConv?.id ?? run.conversationId
            };
            onChange(next);
            onPersist(next);
          }}
        >
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.label}
            </option>
          ))}
        </select>
      </ShellRow>

      <ShellRow>
        <ShellFieldLabel htmlFor={`schedule-conversation-${run.id}`}>Conversation</ShellFieldLabel>
        <select
          id={`schedule-conversation-${run.id}`}
          className="vx-select w-full"
          value={run.conversationId}
          disabled={workspaceConversations.length === 0}
          onChange={(e) => {
            const next = { ...run, conversationId: e.target.value };
            onChange(next);
            onPersist(next);
          }}
        >
          {workspaceConversations.length === 0 ? (
            <option value={run.conversationId}>No conversations in workspace</option>
          ) : (
            workspaceConversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || c.id}
              </option>
            ))
          )}
        </select>
      </ShellRow>

      <ShellRow>
        <ShellFieldLabel htmlFor={`schedule-model-${run.id}`}>Model</ShellFieldLabel>
        <select
          id={`schedule-model-${run.id}`}
          className="vx-select w-full"
          value={resolvedModelValue}
          onChange={(e) => {
            const raw = e.target.value;
            const [providerId, modelId] = raw.split('\u0000');
            if (!providerId || !modelId) return;
            const next = { ...run, providerId, modelId };
            onChange(next);
            onPersist(next);
          }}
        >
          {modelOptions.length === 0 ? (
            <option value="">No models available</option>
          ) : (
            modelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          )}
        </select>
      </ShellRow>

      <ShellRow>
        <ShellFieldLabel htmlFor={`schedule-interval-${run.id}`}>Interval</ShellFieldLabel>
        <select
          id={`schedule-interval-${run.id}`}
          className="vx-select w-full"
          value={String(run.intervalMinutes)}
          onChange={(e) => {
            const minutes = Number(e.target.value);
            if (!Number.isFinite(minutes)) return;
            const next = { ...run, intervalMinutes: minutes };
            onChange(next);
            onPersist(next);
          }}
        >
          {INTERVAL_PRESETS.map((preset) => (
            <option key={preset.minutes} value={preset.minutes}>
              {preset.label}
            </option>
          ))}
        </select>
      </ShellRow>

      <label className="vx-settings-field flex flex-col gap-1.5">
        <span className="text-meta text-text-muted">Prompt</span>
        <textarea
          className="vx-textarea min-h-[5rem]"
          value={run.prompt}
          placeholder="Message sent to the agent on each tick…"
          onChange={(e) => onChange({ ...run, prompt: e.target.value })}
          onBlur={(e) => onPersist({ ...run, prompt: e.target.value })}
        />
      </label>

      <Button variant="secondary" size="sm" onClick={onDelete}>
        Delete schedule
      </Button>
    </div>
  );
}

export function ScheduledRunsPanel() {
  const workspaces = useWorkspaceStore((s) => s.list);
  const conversations = useConversationsStore((s) => s.list);
  const settings = useSettingsStore((s) => s.settings);
  const providers = useProviderStore((s) => s.providers);
  const [runs, setRuns] = useState<ScheduledRun[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await vyotiq.scheduledRuns.list());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const defaultModel = settings.defaultModel;

  const modelOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    for (const p of providers) {
      if (!p.enabled) continue;
      for (const m of p.models ?? []) {
        out.push({
          value: `${p.id}\u0000${m.id}`,
          label: `${p.name} / ${m.id}`
        });
      }
    }
    return out;
  }, [providers]);

  const onAdd = async () => {
    const ws = workspaces[0];
    if (!ws || !defaultModel) return;
    const conv =
      conversations.find((c) => c.workspaceId === ws.id) ??
      (await vyotiq.conversations.create(ws.id));
    await vyotiq.scheduledRuns.upsert({
      enabled: false,
      label: 'New scheduled run',
      workspaceId: ws.id,
      conversationId: conv.id,
      prompt: '',
      providerId: defaultModel.providerId,
      modelId: defaultModel.modelId,
      intervalMinutes: 60
    });
    await refresh();
  };

  const updateRun = (id: string, patch: ScheduledRun) => {
    setRuns((prev) => prev.map((r) => (r.id === id ? patch : r)));
  };

  return (
    <ShellSection title="Scheduled runs">
      <ShellStack>
        <ShellCaption>
          Dispatches the prompt to the chosen conversation on the interval while Vyotiq is open
          (minimum 5 minutes). Skips a tick when that conversation already has an active agent run.
        </ShellCaption>
        {loading ? (
          <ShellCaption>Loading…</ShellCaption>
        ) : runs.length === 0 ? (
          <ShellCaption>No schedules yet.</ShellCaption>
        ) : (
          runs.map((run) => (
            <ScheduledRunCard
              key={run.id}
              run={run}
              workspaces={workspaces.map((ws) => ({ id: ws.id, label: ws.label }))}
              conversations={conversations
                .filter((c): c is typeof c & { workspaceId: string } => typeof c.workspaceId === 'string')
                .map((c) => ({
                  id: c.id,
                  title: c.title,
                  workspaceId: c.workspaceId
                }))}
              modelOptions={modelOptions}
              onChange={(next) => updateRun(run.id, next)}
              onPersist={(next) => persistRun(next, refresh)}
              onDelete={() => void vyotiq.scheduledRuns.delete(run.id).then(refresh)}
            />
          ))
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={!defaultModel || workspaces.length === 0}
          onClick={() => void onAdd()}
        >
          Add schedule
        </Button>
      </ShellStack>
    </ShellSection>
  );
}
