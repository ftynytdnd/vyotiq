import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Chip } from '../ui/Chip.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { TextField } from '../ui/TextField.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { cn } from '../../lib/cn.js';
import {
  PROVIDER_DIALECTS,
  PROVIDER_DIALECT_LABELS,
  type ProviderDialect
} from '@shared/types/provider.js';
import { describeBaseUrl } from './baseUrlValidation.js';

interface AddProviderFormProps {
  onAdded?: () => void;
}

interface Preset {
  label: string;
  baseUrl: string;
  dialect: ProviderDialect;
}

const PRESETS: Preset[] = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com', dialect: 'openai' },
  // OpenRouter is OpenAI-compatible; the canonical base is
  // `https://openrouter.ai/api` (the chat client appends `/v1/...`
  // itself). The base-URL normalizer is dialect-aware so the `/api`
  // segment is preserved on submit. App-attribution headers
  // (`HTTP-Referer`, `X-OpenRouter-Title`) are auto-attached for this
  // host by `attributionHeaders.ts`; users can override per-provider
  // from the row's "OpenRouter attribution" section.
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', dialect: 'openai' },
  // Local Ollama speaks BOTH dialects — default to openai (the shim) so
  // tool calling works without any extra setup. Users can flip the
  // dialect switch if they prefer the native API.
  { label: 'Ollama (local)', baseUrl: 'http://localhost:11434', dialect: 'openai' },
  // Ollama Cloud ONLY speaks the native dialect — /v1/* is a 404 there.
  { label: 'Ollama Cloud', baseUrl: 'https://ollama.com', dialect: 'ollama-native' },
  { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234', dialect: 'openai' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai', dialect: 'openai' },
  { label: 'Together', baseUrl: 'https://api.together.xyz', dialect: 'openai' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', dialect: 'openai' }
];

/**
 * Returns true when the (post-normalization) URL targets OpenRouter,
 * so the form can render the attribution-default hint inline. Mirrors
 * the host check in `attributionHeaders.isOpenRouterHost` — if either
 * gets out of sync, the hint will lie about the headers actually sent.
 */
function isOpenRouterUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl.trim()).hostname.toLowerCase();
    return host === 'openrouter.ai' || host === 'www.openrouter.ai';
  } catch {
    return false;
  }
}

export function AddProviderForm({ onAdded }: AddProviderFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [dialect, setDialect] = useState<ProviderDialect>('openai');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = useProviderStore((s) => s.add);

  const validation = useMemo(
    () => (baseUrl.trim().length === 0 ? null : describeBaseUrl(baseUrl, dialect)),
    [baseUrl, dialect]
  );

  const reset = () => {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setDialect('openai');
    setErr(null);
  };

  const submit = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      setErr('Name and Base URL are required.');
      return;
    }
    if (validation?.severity === 'error') {
      setErr(validation.message);
      return;
    }
    // Silently accept the normalized form (e.g. strip trailing `/v1`).
    const effectiveBaseUrl = validation?.normalized ?? baseUrl.trim();
    setBusy(true);
    setErr(null);
    try {
      await add({
        name: name.trim(),
        baseUrl: effectiveBaseUrl,
        apiKey: apiKey.trim(),
        dialect
      });
      reset();
      setOpen(false);
      onAdded?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" strokeWidth={2.25} /> Add provider
      </Button>
    );
  }

  const validationToneClass =
    validation?.severity === 'error'
      ? 'text-danger'
      : validation?.severity === 'warn'
        ? 'text-warning'
        : 'text-text-muted';

  return (
    <div className="flex flex-col gap-2.5 border-l border-border-subtle/40 py-1 pl-3">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <Chip
            key={p.label}
            as="button"
            tone="muted"
            className="rounded-inner px-2.5 py-1"
            onClick={() => {
              setName(p.label);
              setBaseUrl(p.baseUrl);
              setDialect(p.dialect);
            }}
          >
            {p.label}
          </Chip>
        ))}
      </div>
      <Field label="Name" value={name} onChange={setName} placeholder="e.g. OpenAI" />
      <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.openai.com" />
      {validation && (
        <div className={cn('text-row', validationToneClass)}>{validation.message}</div>
      )}
      {isOpenRouterUrl(baseUrl) && dialect === 'openai' && (
        <div className="text-row text-text-muted">
          Auto-attributing as Vyotiq · vyotiq.app for OpenRouter rankings. Adjust later in the provider settings.
        </div>
      )}
      <DialectSwitch value={dialect} onChange={setDialect} />
      <Field
        label="API Key"
        value={apiKey}
        onChange={setApiKey}
        placeholder="sk-… (leave blank for local providers without auth)"
        password
      />
      {err && <div className="text-row text-danger">{err}</div>}
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || validation?.severity === 'error'}
          onClick={() => void submit()}
        >
          {busy ? 'Adding…' : 'Add & discover'}
        </Button>
      </div>
    </div>
  );
}

function DialectSwitch({
  value,
  onChange
}: {
  value: ProviderDialect;
  onChange: (next: ProviderDialect) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <Eyebrow as="span" size="row">Dialect</Eyebrow>
      <div className="flex overflow-hidden rounded-inner bg-surface-base">
        {PROVIDER_DIALECTS.map((d) => {
          const active = d === value;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onChange(d)}
              className={cn(
                'flex-1 px-3 py-1.5 text-row transition-colors duration-150',
                active
                  ? 'bg-surface-hover text-text-primary'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              {PROVIDER_DIALECT_LABELS[d]}
            </button>
          );
        })}
      </div>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  password
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <Eyebrow as="span" size="row">{label}</Eyebrow>
      <TextField
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        size="lg"
        tone="raised"
      />
    </label>
  );
}
