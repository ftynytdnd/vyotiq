/**
 * Theme, density, and reduced-motion application for the renderer.
 * `applyAppTheme` runs before first React paint (main.tsx) and whenever
 * settings hydrate or the user changes Appearance prefs.
 */

import type { AppSettings } from '@shared/types/ipc.js';
import { vyotiq } from './ipc.js';

export type AppThemeMode = 'dark' | 'light' | 'system';
export type AppDensity = 'compact' | 'balanced' | 'airy';

export interface ThemePrefs {
  theme: AppThemeMode;
  density: AppDensity;
  reducedMotion: boolean;
}

const STORAGE_KEY = 'vyotiq.theme.prefs';

export const DEFAULT_THEME_PREFS: ThemePrefs = {
  theme: 'dark',
  density: 'balanced',
  reducedMotion: false
};

export function themePrefsFromSettings(settings: AppSettings | null | undefined): ThemePrefs {
  const ui = settings?.ui;
  const theme =
    ui?.theme === 'light' || ui?.theme === 'system' || ui?.theme === 'dark'
      ? ui.theme
      : DEFAULT_THEME_PREFS.theme;
  const density =
    ui?.density === 'compact' || ui?.density === 'airy' || ui?.density === 'balanced'
      ? ui.density
      : DEFAULT_THEME_PREFS.density;
  const reducedMotion =
    typeof ui?.reducedMotion === 'boolean' ? ui.reducedMotion : DEFAULT_THEME_PREFS.reducedMotion;
  return { theme, density, reducedMotion };
}

export function readCachedThemePrefs(): ThemePrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_THEME_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME_PREFS };
    const parsed = JSON.parse(raw) as Partial<ThemePrefs>;
    return {
      theme:
        parsed.theme === 'light' || parsed.theme === 'system' || parsed.theme === 'dark'
          ? parsed.theme
          : DEFAULT_THEME_PREFS.theme,
      density:
        parsed.density === 'compact' || parsed.density === 'airy' || parsed.density === 'balanced'
          ? parsed.density
          : DEFAULT_THEME_PREFS.density,
      reducedMotion:
        typeof parsed.reducedMotion === 'boolean'
          ? parsed.reducedMotion
          : DEFAULT_THEME_PREFS.reducedMotion
    };
  } catch {
    return { ...DEFAULT_THEME_PREFS };
  }
}

export function cacheThemePrefs(prefs: ThemePrefs): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

/** Resolved light/dark for CSS `data-theme`. */
export function resolveAppTheme(mode: AppThemeMode): 'dark' | 'light' {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function osPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function effectiveReducedMotion(prefs: ThemePrefs): boolean {
  return prefs.reducedMotion || osPrefersReducedMotion();
}

export function applyAppTheme(prefs: ThemePrefs): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveAppTheme(prefs.theme);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.density = prefs.density;
  root.dataset.reducedMotion = effectiveReducedMotion(prefs) ? 'true' : 'false';
  cacheThemePrefs(prefs);
  void syncNativeTheme(prefs.theme);
}

async function syncNativeTheme(mode: AppThemeMode): Promise<void> {
  try {
    await vyotiq.app.setThemeSource(mode);
  } catch {
    /* bridge unavailable in tests */
  }
}

let systemListener: (() => void) | null = null;

/** Re-resolve when OS scheme changes while theme is `system`. */
export function watchSystemTheme(onChange: (prefs: ThemePrefs) => void, getPrefs: () => ThemePrefs): void {
  if (typeof window === 'undefined') return;
  systemListener?.();
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    const prefs = getPrefs();
    if (prefs.theme !== 'system') return;
    applyAppTheme(prefs);
    onChange(prefs);
  };
  mq.addEventListener('change', handler);
  systemListener = () => mq.removeEventListener('change', handler);
}

export function stopWatchSystemTheme(): void {
  systemListener?.();
  systemListener = null;
}
