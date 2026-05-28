import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME_PREFS,
  cacheThemePrefs,
  readCachedThemePrefs,
  resolveAppTheme,
  effectiveReducedMotion,
  themePrefsFromSettings,
  type ThemePrefs
} from '@renderer/lib/theme';

/**
 * happy-dom's `localStorage` is a Proxy that doesn't allow direct
 * property replacement. We substitute the entire global with a plain
 * in-memory object that satisfies the Web Storage API surface used by
 * the module under test (`getItem`, `setItem`).
 */
let store: Record<string, string> = {};
const fakeStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { store = {}; },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null
} as unknown as Storage;

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', fakeStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DEFAULT_THEME_PREFS', () => {
  it('has dark theme, balanced density, and reduced-motion off', () => {
    expect(DEFAULT_THEME_PREFS).toEqual({
      theme: 'dark',
      density: 'balanced',
      reducedMotion: false
    });
  });
});

describe('resolveAppTheme', () => {
  it('returns dark for dark mode', () => {
    expect(resolveAppTheme('dark')).toBe('dark');
  });

  it('returns light for light mode', () => {
    expect(resolveAppTheme('light')).toBe('light');
  });

  it('falls back for system mode (depends on matchMedia)', () => {
    // happy-dom's matchMedia matches `prefers-color-scheme: light`,
    // so `system` resolves to `light` here. The contract is: system
    // mode delegates to the OS media query; the function never throws.
    const result = resolveAppTheme('system');
    expect(['dark', 'light']).toContain(result);
  });
});

describe('effectiveReducedMotion', () => {
  it('returns false when pref is off and OS does not prefer reduced motion', () => {
    expect(effectiveReducedMotion({ ...DEFAULT_THEME_PREFS, reducedMotion: false })).toBe(false);
  });

  it('returns true when pref is on regardless of OS setting', () => {
    expect(effectiveReducedMotion({ ...DEFAULT_THEME_PREFS, reducedMotion: true })).toBe(true);
  });
});

describe('cacheThemePrefs / readCachedThemePrefs round-trip', () => {
  it('returns defaults when nothing is cached', () => {
    expect(readCachedThemePrefs()).toEqual(DEFAULT_THEME_PREFS);
  });

  it('round-trips a custom pref set through localStorage', () => {
    const prefs: ThemePrefs = { theme: 'light', density: 'compact', reducedMotion: true };
    cacheThemePrefs(prefs);
    expect(readCachedThemePrefs()).toEqual(prefs);
  });

  it('returns defaults for corrupted localStorage data', () => {
    store['vyotiq.theme.prefs'] = '{bad json';
    expect(readCachedThemePrefs()).toEqual(DEFAULT_THEME_PREFS);
  });

  it('falls back to defaults for partial prefs with invalid values', () => {
    store['vyotiq.theme.prefs'] = JSON.stringify({ theme: 'neon', density: 'huge', reducedMotion: 'maybe' });
    expect(readCachedThemePrefs()).toEqual(DEFAULT_THEME_PREFS);
  });
});

describe('themePrefsFromSettings', () => {
  it('returns defaults for null settings', () => {
    expect(themePrefsFromSettings(null)).toEqual(DEFAULT_THEME_PREFS);
  });

  it('returns defaults for undefined settings', () => {
    expect(themePrefsFromSettings(undefined)).toEqual(DEFAULT_THEME_PREFS);
  });

  it('extracts valid ui fields from settings', () => {
    const settings = { ui: { theme: 'light', density: 'airy', reducedMotion: true } } as never;
    expect(themePrefsFromSettings(settings)).toEqual({
      theme: 'light',
      density: 'airy',
      reducedMotion: true
    });
  });

  it('falls back to defaults for invalid ui field values', () => {
    const settings = { ui: { theme: 'nope', density: 99, reducedMotion: 'yes' } } as never;
    expect(themePrefsFromSettings(settings)).toEqual(DEFAULT_THEME_PREFS);
  });
});
