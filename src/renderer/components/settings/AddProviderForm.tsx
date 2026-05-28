import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import {
  ShellActionRow,
  ShellCaption,
  ShellFieldActions,
  ShellFieldLabel,
  ShellRow
} from '../ui/ShellSection.js';
import {
  PROVIDER_DIALECTS,
  PROVIDER_DIALECT_LABELS,
  type ProviderDialect
} from '@shared/types/provider.js';
import { describeBaseUrl } from './baseUrlValidation.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

const DIALECT_TABS: TabItem<ProviderDialect>[] = PROVIDER_DIALECTS.map((d) => ({
  id: d,
  label: PROVIDER_DIALECT_LABELS[d]
}));

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
  { label: 'Anthropic', baseUrl: 'https://api.anthropic.com', dialect: 'anthropic-native' },
  {
    label: 'Gemini (AI Studio)',
    baseUrl: 'https://generativelanguage.googleapis.com',
    dialect: 'gemini-native'
  },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', dialect: 'openai' },
  { label: 'Ollama (local)', baseUrl: 'http://localhost:11434', dialect: 'openai' },
  { label: 'Ollama Cloud', baseUrl: 'https://ollama.com', dialect: 'ollama-native' },
  { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234', dialect: 'openai' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai', dialect: 'openai' },
  { label: 'Together', baseUrl: 'https://api.together.xyz', dialect: 'openai' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', dialect: 'openai' }
];

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
      <Button variant="link" onClick={() => setOpen(true)}>
        <Plus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} /> Add provider
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
    <div className="flex flex-col gap-3">
      <ShellActionRow className="flex-wrap gap-1 pt-0">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="vx-segment-item rounded px-2 py-1"
            onClick={() => {
              setName(p.label);
              setBaseUrl(p.baseUrl);
              setDialect(p.dialect);
            }}
          >
            {p.label}
          </button>
        ))}
      </ShellActionRow>

      <Field label="Name" value={name} onChange={setName} placeholder="e.g. OpenAI" />
      <Field label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.openai.com" />

      {validation && (
        <ShellCaption className={validationToneClass}>{validation.message}</ShellCaption>
      )}

      {isOpenRouterUrl(baseUrl) && dialect === 'openai' && (
        <ShellCaption>
          Auto-attributing as Vyotiq · vyotiq.app for OpenRouter rankings. Adjust later in the
          provider settings.
        </ShellCaption>
      )}

      <DialectSwitch value={dialect} onChange={setDialect} />

      <Field
        label="API Key"
        value={apiKey}
        onChange={setApiKey}
        placeholder="sk-… (leave blank for local providers without auth)"
        password
      />

      {err && <ShellCaption className="text-danger">{err}</ShellCaption>}

      <ShellFieldActions grouped>
        <Button variant="ghost" onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || validation?.severity === 'error'}
          onClick={() => void submit()}
        >
          {busy ? 'Adding…' : 'Add & discover'}
        </Button>
      </ShellFieldActions>
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
    <ShellRow className="py-0">
      <ShellFieldLabel>Provider dialect</ShellFieldLabel>
      <Tabs<ProviderDialect>
        items={DIALECT_TABS}
        value={value}
        onChange={onChange}
        variant="segmented"
        size="md"
        ariaLabel="Provider dialect"
        className="mt-2"
      />
    </ShellRow>
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
    <ShellRow className="py-0">
      <ShellFieldLabel>{label}</ShellFieldLabel>
      <TextField
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1"
      />
    </ShellRow>
  );
}
