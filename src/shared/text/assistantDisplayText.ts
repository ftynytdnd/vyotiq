/**
 * Assistant-turn display text for the timeline.
 * Strips legacy orchestration XML the model once embedded in prose.
 */

import { stripDelegatesForDisplay } from './strip.js';

export function displayAssistantTurnText(text: string): string {
  return stripDelegatesForDisplay(text);
}
