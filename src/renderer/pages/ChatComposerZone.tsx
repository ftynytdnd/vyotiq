/**
 * ChatComposerZone — composer input embedded in {@link ChatFooter}.
 */

import { Composer } from '../components/composer/Composer.js';
import type { ModelSelection } from '@shared/types/provider.js';

interface ChatComposerZoneProps {
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
  /** Empty-chat landing — wider shell and landing placeholder copy. */
  landing?: boolean;
  /** Focus the message field when the empty-chat landing is shown. */
  requestFocus?: boolean;
  /** Changes re-trigger focus (e.g. switching empty conversations). */
  focusSession?: string | null;
}

export function ChatComposerZone({
  model,
  onModelChange,
  onOpenProviders,
  landing,
  requestFocus,
  focusSession
}: ChatComposerZoneProps) {
  return (
    <Composer
      model={model}
      onModelChange={onModelChange}
      onOpenProviders={onOpenProviders}
      landing={landing}
      requestFocus={requestFocus}
      focusSession={focusSession}
    />
  );
}
