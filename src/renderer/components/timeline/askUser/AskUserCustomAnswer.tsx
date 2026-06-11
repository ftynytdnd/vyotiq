/**
 * Custom free-text answer row — same chrome as preset options.
 */

import { useId } from 'react';
import { AskUserOptionButton } from './AskUserOptionButton.js';

interface AskUserCustomAnswerProps {
  value: string;
  placeholder: string;
  allowMultiple: boolean;
  onChange: (value: string) => void;
}

export function AskUserCustomAnswer({
  value,
  placeholder,
  allowMultiple,
  onChange
}: AskUserCustomAnswerProps) {
  const inputId = useId();
  const selected = value.trim().length > 0;

  return (
    <AskUserOptionButton
      as="label"
      htmlFor={inputId}
      selected={selected}
      allowMultiple={allowMultiple}
    >
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full border-0 bg-transparent p-0 font-mono text-meta text-text-primary placeholder:text-text-faint focus:outline-none"
      />
    </AskUserOptionButton>
  );
}
