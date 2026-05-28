import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src/renderer');

describe('typography contracts', () => {
  it('index.css uses Geist font stacks', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8');
    expect(css).toContain('"Geist Variable"');
    expect(css).toContain('"Geist Mono Variable"');
    expect(css).not.toContain('"Inter"');
  });

  it('index.css declares compact spacing tokens', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8');
    expect(css).toContain('--spacing-chrome-y');
    expect(css).toContain('--spacing-row-y');
    expect(css).toContain('--spacing-section-gap');
  });

  it('index.css does not override vx-caption size in timeline', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8');
    expect(css).not.toMatch(/\.vx-timeline-stack\s+\.vx-caption/);
    expect(css).not.toMatch(/\.timeline-agent-column\s+\.vx-caption/);
    expect(css).toContain('.vx-timeline-meta');
  });

  it('index.css declares boxed numeric fields and run-closer meta size', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8');
    expect(css).toContain('.vx-input-boxed');
    expect(css).toMatch(
      /\[data-row-kind='run-complete'\][\s\S]*font-size:\s*var\(--text-chat-meta\)/
    );
  });

  it('index.css declares frameless surface + chrome tokens', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8');
    expect(css).toContain('--color-chrome-active');
    expect(css).toContain('--color-surface-sidebar');
    expect(css).toContain('--color-surface-input');
    expect(css).toContain('--radius-composer');
    expect(css).toContain('--text-hero');
  });

  it('index.css is Linear-lite frameless (flat sections, light type)', () => {
    const css = readFileSync(join(root, 'index.css'), 'utf8');
    expect(css).toContain('var(--color-chrome-active)');
    expect(css).toContain('.vx-btn-accent-fill');
    expect(css).toContain('.vx-btn-link');
    expect(css).toContain('.vx-section-body--rail');
    expect(css).toContain('.vx-panel-body .vx-btn-primary');
    expect(css).toMatch(/\.vx-section-head[\s\S]*font-weight:\s*500/);
    expect(css).toMatch(/\.vx-panel-title[\s\S]*font-weight:\s*500/);
    expect(css).not.toMatch(/\.vx-composer-shell[\s\S]*box-shadow:[\s\S]*0 8px 24px/);
    expect(css).not.toMatch(/\.vx-dock-tab\[data-active='true'\][\s\S]*border-left:/);
    expect(css).not.toMatch(/\.vx-btn:focus-visible[\s\S]*outline:\s*2px solid/);
  });
});
