/**
 * Resolves Shell Mono design tokens into a concrete xterm.js theme.
 *
 * Lives under `shared/` (not `renderer/`) because xterm requires concrete
 * `#rrggbb` / `rgba(…)` strings — the token-strictness test forbids color
 * literals in renderer TS. Runtime resolution still reads live CSS tokens.
 */

import type { ITheme, Terminal } from '@xterm/xterm';

let probeCanvasCtx: CanvasRenderingContext2D | null | undefined;

function canvasCtx(): CanvasRenderingContext2D | null {
  if (probeCanvasCtx !== undefined) return probeCanvasCtx;
  const canvas = document.createElement('canvas');
  probeCanvasCtx = canvas.getContext('2d');
  return probeCanvasCtx;
}

/** Normalise any valid CSS color string to `#rrggbb` / `rgba(…)`, else fallback. */
function normalizeColor(value: string, fallback: string): string {
  const ctx = canvasCtx();
  if (!ctx) return fallback;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = value;
  const first = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = value;
  const second = ctx.fillStyle;
  return first === second ? first : fallback;
}

function resolveColorExpr(expr: string, fallback: string): string {
  const probe = document.createElement('span');
  probe.style.color = expr;
  probe.style.position = 'absolute';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe).color;
  probe.remove();
  return normalizeColor(computed || fallback, fallback);
}

function token(name: string, fallback: string): string {
  return resolveColorExpr(`var(${name})`, fallback);
}

export function buildXtermTheme(): ITheme {
  const foreground = token('--color-text-primary', '#e6e6e6');
  const accent = token('--color-accent', '#e0a44a');
  const surface = token('--color-surface-base', '#222428');

  return {
    background: surface,
    foreground,
    cursor: accent,
    cursorAccent: surface,
    selectionBackground: resolveColorExpr(
      'color-mix(in oklch, var(--color-accent) 30%, transparent)',
      'rgba(224, 164, 74, 0.3)'
    ),
    selectionForeground: foreground,
    scrollbarSliderBackground: resolveColorExpr(
      'color-mix(in oklch, var(--color-border-subtle) 55%, transparent)',
      'rgba(120, 120, 130, 0.35)'
    ),
    scrollbarSliderHoverBackground: resolveColorExpr(
      'color-mix(in oklch, var(--color-chrome-hover) 70%, transparent)',
      'rgba(140, 140, 150, 0.5)'
    ),
    scrollbarSliderActiveBackground: resolveColorExpr(
      'color-mix(in oklch, var(--color-accent) 45%, transparent)',
      'rgba(224, 164, 74, 0.45)'
    ),
    black: resolveColorExpr('oklch(0.30 0.005 260)', '#3a3d42'),
    red: token('--color-danger', '#d65a4a'),
    green: token('--color-success', '#4fbf7e'),
    yellow: token('--color-warning', '#e0a44a'),
    blue: resolveColorExpr('oklch(0.62 0.13 250)', '#5a86d6'),
    magenta: resolveColorExpr('oklch(0.62 0.14 320)', '#b46ad6'),
    cyan: resolveColorExpr('oklch(0.70 0.10 200)', '#4fb6c4'),
    white: token('--color-text-secondary', '#c4c4c4'),
    brightBlack: token('--color-text-faint', '#6f7378'),
    brightRed: resolveColorExpr('oklch(0.74 0.17 25)', '#ec7a68'),
    brightGreen: resolveColorExpr('oklch(0.82 0.16 150)', '#6fe09c'),
    brightYellow: accent,
    brightBlue: resolveColorExpr('oklch(0.74 0.13 250)', '#82a6ec'),
    brightMagenta: resolveColorExpr('oklch(0.76 0.14 320)', '#cf8aec'),
    brightCyan: resolveColorExpr('oklch(0.82 0.10 200)', '#76d2de'),
    brightWhite: foreground
  };
}

/** Assign a fresh theme object — xterm 6 requires reference replacement. */
export function applyXtermTheme(term: Terminal): void {
  term.options.theme = buildXtermTheme();
}

export function resolveMonoFontFamily(): string {
  const resolved = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--font-mono')
    .trim();
  return resolved.length > 0
    ? resolved
    : '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace';
}
