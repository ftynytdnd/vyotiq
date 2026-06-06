/**
 * ChatComposerZone — composer input embedded in {@link ChatFooter}.
 */

import { Composer } from '../components/composer/Composer.js';
import type { ModelSelection } from '@shared/types/provider.js';
interface ChatComposerZoneProps {
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
}

export function ChatComposerZone({
  model,
  onModelChange,
  onOpenProviders
}: ChatComposerZoneProps) {
  return (
    <Composer
      model={model}
      onModelChange={onModelChange}
      onOpenProviders={onOpenProviders}
    />
  );
}
