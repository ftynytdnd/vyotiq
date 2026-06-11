/**
 * Adaptive reading-column width for chat timeline + composer.
 * Narrows when the attachment preview zone is open; widens otherwise.
 */

export function timelineContentWidthClass(zoneOpen: boolean): string {
  return zoneOpen ? 'max-w-2xl' : 'max-w-4xl';
}

/** CSS custom property for agent-column max-width (matches content column). */
export function timelineAgentColumnMaxWidth(zoneOpen: boolean): string {
  return zoneOpen ? '42rem' : '52rem';
}
