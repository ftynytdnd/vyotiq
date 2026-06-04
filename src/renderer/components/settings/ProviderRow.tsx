/**
 * One row in the providers list inside the settings modal. Renders the
 * provider's name, dialect tag, base URL, enable/disable + remove
 * actions, "discover models" + "test connection" buttons, the
 * accompanying status banner, and the discovered-models list.
 *
 * Intentionally NOT card-styled: no border, no background elevation,
 * no rounded surface — element separation is by padding and the
 * `divide-y` between sibling rows in `ProvidersPanel`. This matches
 * the project's stealth-dark aesthetic where surfaces lean on
 * background contrast rather than visible boxes.
 */
import { useMemo, useState } from 'react';
import {
  Trash2,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp
} from 'lucide-react';
import {
  PROVIDER_DIALECT_LABELS,
  type ProviderAttribution,
  type ProviderConfig
} from '@shared/types/provider.js';
import { Button } from '../ui/Button.js';
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import { Switch } from '../ui/Switch.js';
import { TextField } from '../ui/TextField.js';
import { ModelList } from './ModelList.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import {
  ShellActionRow,
  ShellCaption,
  ShellFieldActions,
  ShellFieldLabel,
  ShellRow,
  ShellRowSplit
} from '../ui/ShellSection.js';
import {
  SHELL_COMPACT_ICON_CLASS,
  SHELL_COMPACT_ICON_STROKE,
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';

interface ProviderRowProps {
  provider: ProviderConfig;
}

export function ProviderRow({
  provider,
  onCollapse
}: ProviderRowProps & { embedded?: boolean; onCollapse?: () => void }) {
  const remove = useProviderStore((s) => s.remove);
  const discover = useProviderStore((s) => s.discover);
  const test = useProviderStore((s) => s.test);
  const update = useProviderStore((s) => s.update);

  const [busy, setBusy] = useState<'idle' | 'discovering' | 'testing'>('idle');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Two-step removal so a misclicked trash icon doesn't wipe the
  // provider config + encrypted API key with no recovery. Mirrors
  // the confirmation pattern used by the dock chat tab /
  // workspace deletes.
  const [removeOpen, setRemoveOpen] = useState(false);

  const onDiscover = async () => {
    setBusy('discovering');
    setTestResult(null);
    try {
      await discover(provider.id);
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('idle');
    }
  };

  const onTest = async () => {
    setBusy('testing');
    try {
      const result = await test(provider.id);
      setTestResult(result);
      if (result.ok) await discover(provider.id);
    } finally {
      setBusy('idle');
    }
  };

  return (
    <ShellRow>
      {removeOpen ? (
        <DestructiveConfirm
          variant="inline"
          open
          context={provider.name}
          question="Remove provider?"
          confirmLabel="Remove"
          onConfirm={() => {
            setRemoveOpen(false);
            void remove(provider.id);
          }}
          onCancel={() => setRemoveOpen(false)}
        />
      ) : (
        <ShellRowSplit
          main={
            <>
              <div className="vx-row-label">{provider.name}</div>
              <div className="vx-provider-meta">{provider.baseUrl}</div>
              <ShellCaption className="mt-1">
                {PROVIDER_DIALECT_LABELS[provider.dialect ?? 'openai']}
              </ShellCaption>
            </>
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onCollapse ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCollapse}
                  title="Collapse provider details"
                >
                  <ChevronUp
                    className={SHELL_ROW_ICON_CLASS}
                    strokeWidth={SHELL_ROW_ICON_STROKE}
                  />
                </Button>
              ) : null}
              <Switch
                size="md"
                value={provider.enabled}
                onChange={(v) => void update(provider.id, { enabled: v })}
                ariaLabel={`${provider.enabled ? 'Disable' : 'Enable'} provider ${provider.name}`}
              />
              <Button
                variant="danger"
                aria-label={`Remove provider ${provider.name}`}
                onClick={() => setRemoveOpen(true)}
              >
                <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
              </Button>
            </div>
          }
        />
      )}

      {!removeOpen && (
      <>
      <ShellActionRow>
        <Button variant="secondary" onClick={() => void onDiscover()} disabled={busy !== 'idle'}>
          <RefreshCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
          {busy === 'discovering'
            ? 'Discovering…'
            : provider.dialect === 'ollama-native'
              ? 'Refresh /api/tags'
              : 'Refresh /v1/models'}
        </Button>
        <Button variant="ghost" onClick={() => void onTest()} disabled={busy !== 'idle'}>
          {busy === 'testing' ? 'Testing…' : 'Test connection'}
        </Button>
        {testResult && !testResult.ok && (
          <div className="flex items-center gap-1.5 vx-caption text-danger">
            <XCircle className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            <span className="line-clamp-2">{testResult.message}</span>
          </div>
        )}
      </ShellActionRow>

      <ModelList
        models={provider.models ?? []}
        loading={busy === 'discovering'}
        emptyMessage="No models discovered yet."
        onDiscover={() => void onDiscover()}
        discoverDisabled={busy !== 'idle'}
        dialect={provider.dialect}
        thinkingByModel={provider.modelThinking}
        onThinkingChange={(modelId, effort) =>
          void update(provider.id, { modelThinking: { [modelId]: effort } })
        }
      />

      <AttributionSection provider={provider} onSave={(next) => void update(provider.id, { attribution: next })} />
      </>
      )}
    </ShellRow>
  );
}

/**
 * Returns true when `baseUrl` parses to an OpenRouter host. Mirrors the
 * runtime check in `src/main/providers/attributionHeaders.ts`. Kept
 * inline (instead of imported from the main bundle) because the
 * renderer cannot reach @main/* under our path mapping; the rule is
 * one line either way and the unit test for `attributionHeaders` is
 * the canary that flags drift.
 */
function isOpenRouterHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'openrouter.ai' || host === 'www.openrouter.ai';
  } catch {
    return false;
  }
}

/**
 * Inline editor for OpenRouter app-attribution headers (`HTTP-Referer`
 * + `X-OpenRouter-Title`). Rendered ONLY for providers whose base URL
 * is OpenRouter — every other host treats these headers as no-ops, so
 * surfacing them universally would add noise.
 *
 * Resolution semantics (must match `buildAttributionHeaders`):
 *   - Field left blank in the UI ⇒ persisted as `''` (explicit
 *     suppression for that single header).
 *   - Field with non-empty value  ⇒ persisted verbatim.
 *   - Section never opened        ⇒ `attribution` is preserved as-is
 *                                   on the provider record (defaults
 *                                   apply at send time).
 *
 * The collapsed header doubles as the auto-default disclosure: when no
 * override is set the row reads "Auto: Vyotiq · vyotiq.app", so the
 * user knows what's being sent without expanding.
 */
function AttributionSection({
  provider,
  onSave
}: {
  provider: ProviderConfig;
  onSave: (next: ProviderAttribution) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [referer, setReferer] = useState(provider.attribution?.referer ?? '');
  const [title, setTitle] = useState(provider.attribution?.title ?? '');
  const [savedTick, setSavedTick] = useState(false);

  // Re-seed local state when the underlying record changes (e.g. user
  // saved, then collapsed and reopened a sibling row that updated the
  // same provider via discovery refresh).
  const persistedReferer = provider.attribution?.referer;
  const persistedTitle = provider.attribution?.title;
  const persistedKey = useMemo(
    () => `${persistedReferer ?? ''}|${persistedTitle ?? ''}`,
    [persistedReferer, persistedTitle]
  );

  // Reset local edits when the persisted shape changes from the
  // outside. We compare against the snapshot we last saved against to
  // avoid clobbering an in-flight edit.
  //
  // The `if (…) setState(…)` inside the function body is the React-
  // docs-sanctioned "derive state from props during render" pattern
  // (see https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  // React detects the in-render setState on a stable parent component
  // and re-runs THIS component immediately with the new state — no
  // extra commit, no `useEffect`-driven flash. The `seedKey` guard
  // makes the write idempotent so we don't loop. Do NOT migrate this
  // to a `useEffect`: that would clobber a fast user edit between
  // the outer store update and the effect flush.
  const [seedKey, setSeedKey] = useState(persistedKey);
  if (seedKey !== persistedKey) {
    setSeedKey(persistedKey);
    setReferer(persistedReferer ?? '');
    setTitle(persistedTitle ?? '');
  }

  if (!isOpenRouterHost(provider.baseUrl)) return null;

  const collapsedSummary =
    provider.attribution?.referer === undefined && provider.attribution?.title === undefined
      ? 'Auto: Vyotiq · vyotiq.app'
      : 'Custom override';

  const onSubmit = () => {
    // Empty field ⇒ omit from the patch so the host-aware default
    // applies at send time. This is the safe UX: a user who opens
    // the section to change ONLY the title shouldn't accidentally
    // suppress the auto-default Referer they never edited. To
    // explicitly suppress a header (the empty-string contract on the
    // resolver) advanced users still have IPC; the basic UI never
    // generates a suppression.
    const next: ProviderAttribution = {};
    if (referer.trim().length > 0) next.referer = referer.trim();
    if (title.trim().length > 0) next.title = title.trim();
    onSave(next);
    setSavedTick(true);
    window.setTimeout(() => setSavedTick(false), 1500);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="vx-btn-text inline-flex items-center gap-1.5 self-start"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
        ) : (
          <ChevronRight className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} />
        )}
        <span>OpenRouter attribution</span>
        <span className="text-text-faint">· {collapsedSummary}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 py-1">
          <ShellCaption>
            Optional. OpenRouter credits the calling app on its public rankings via these headers.
            Leave a field blank to send an empty value (suppress that header). Clear both to fall back
            to the project defaults.
          </ShellCaption>
          <AttributionField
            label="HTTP-Referer"
            placeholder="https://vyotiq.app"
            value={referer}
            onChange={setReferer}
          />
          <AttributionField
            label="X-OpenRouter-Title"
            placeholder="Vyotiq"
            value={title}
            onChange={setTitle}
          />
          <ShellFieldActions grouped>
            {savedTick && (
              <span className="mr-auto flex items-center gap-1 text-row text-success">
                <CheckCircle2 className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_COMPACT_ICON_STROKE} /> Saved
              </span>
            )}
            <Button variant="primary" onClick={onSubmit}>
              Save attribution
            </Button>
          </ShellFieldActions>
        </div>
      )}
    </div>
  );
}

function AttributionField({
  label,
  placeholder,
  value,
  onChange
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col">
      <ShellFieldLabel>{label}</ShellFieldLabel>
      <TextField
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

