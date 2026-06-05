/**
 * Compact provider label for Recent / Favorites sub-groups (no refresh action).
 */

import { Eyebrow } from '../../ui/Eyebrow.js';

interface ModelPickerProviderLabelProps {
  name: string;
}

export function ModelPickerProviderLabel({ name }: ModelPickerProviderLabelProps) {
  return (
    <div className="vx-model-picker-provider-label px-2 pb-0.5 pt-1">
      <Eyebrow as="span" className="normal-case tracking-normal text-text-faint">
        {name}
      </Eyebrow>
    </div>
  );
}
