import type { TimelineEvent } from '@shared/types/chat.js';
import { redactSensitiveText } from '@shared/text/redactSecretsInText.js';

/** Scrub secrets from tool results before JSONL persistence. */
export function redactEventForPersist(event: TimelineEvent): TimelineEvent {
  if (event.kind !== 'tool-result') return event;
  return {
    ...event,
    result: {
      ...event.result,
      output: redactSensitiveText(event.result.output)
    }
  };
}
