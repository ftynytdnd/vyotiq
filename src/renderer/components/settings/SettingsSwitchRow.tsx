import { Switch } from '../ui/Switch.js';
import { ShellRow, ShellRowSplit } from '../ui/ShellSection.js';

export function SettingsSwitchRow({
  label,
  description,
  value,
  onChange,
  disabled
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <ShellRow>
      <ShellRowSplit
        main={
          <>
            <div className="vx-row-label">{label}</div>
            <p className="vx-row-desc">{description}</p>
          </>
        }
        control={
          <Switch
            size="md"
            value={value}
            onChange={onChange}
            ariaLabel={label}
            disabled={disabled}
          />
        }
      />
    </ShellRow>
  );
}
