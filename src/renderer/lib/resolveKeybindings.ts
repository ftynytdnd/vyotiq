/**
 * Resolve persisted keybinding overrides against defaults.
 */

import {
  defaultKeybindingsRecord,
  KEYBINDING_DEFINITIONS,
  type KeybindingId
} from '@shared/keybindings/defaultKeybindings.js';

export function resolveKeybindings(
  overrides: Record<string, string> | undefined,
  isMac: boolean
): Record<KeybindingId, string> {
  const base = defaultKeybindingsRecord(isMac);
  if (!overrides) return base;
  const out = { ...base };
  for (const def of KEYBINDING_DEFINITIONS) {
    const custom = overrides[def.id];
    if (typeof custom === 'string' && custom.trim().length > 0) {
      out[def.id] = custom.trim();
    }
  }
  return out;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac/i.test(p);
}
