import os from 'node:os';
import process from 'node:process';

function homePlaceholder(): string {
  return process.platform === 'win32' ? '%USERPROFILE%' : '~';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cachedHomeVariants(): string[] {
  let home = '';
  try {
    home = os.homedir();
  } catch {
    return [];
  }
  if (!home) return [];
  return [...new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])].filter(
    (v) => v.length >= 2
  );
}

/**
 * Replace the user profile prefix in an absolute path with a stable
 * placeholder so provider guardrails are less likely to flag OS usernames.
 * Tools still resolve against the real workspace root on disk.
 */
export function redactUserHomeInPath(absPath: string): string {
  if (!absPath) return absPath;
  const variants = cachedHomeVariants();
  if (variants.length === 0) return absPath;

  const norm = (p: string): string => p.replace(/\\/g, '/');
  const pathNorm = norm(absPath);
  for (const home of variants) {
    const homeNorm = norm(home);
    const prefix = homeNorm.endsWith('/') ? homeNorm : `${homeNorm}/`;
    if (!pathNorm.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const rest = pathNorm.slice(prefix.length);
    if (process.platform === 'win32') {
      return rest.length > 0
        ? `${homePlaceholder()}\\${rest.replace(/\//g, '\\')}`
        : homePlaceholder();
    }
    return rest.length > 0 ? `${homePlaceholder()}/${rest}` : homePlaceholder();
  }
  return absPath;
}

/**
 * Replace every occurrence of the runtime user-profile directory in free
 * text (tool output, errors, replayed history) before it is sent to a
 * cloud provider. Preserves path shape so the model can still reason
 * about relative locations.
 */
export function redactUserHomeInText(text: string): string {
  if (!text) return text;
  const variants = cachedHomeVariants();
  if (variants.length === 0) return text;

  const placeholder = homePlaceholder();
  let out = text;
  for (const variant of variants) {
    const patterns =
      process.platform === 'win32'
        ? [variant, variant.replace(/\\/g, '\\\\')]
        : [variant];
    for (const pattern of patterns) {
      const re =
        process.platform === 'win32'
          ? new RegExp(escapeRegex(pattern), 'gi')
          : new RegExp(escapeRegex(pattern), 'g');
      out = out.replace(re, placeholder);
    }
  }
  return out;
}
