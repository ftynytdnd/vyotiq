import { describe, expect, it } from 'vitest';
import {
  buildDesignGrid,
  buildEditRunSummaryBody,
  buildPrChangeGroups,
  buildSeverityTable
} from '@main/tools/reportBodyBuilders';

describe('reportBodyBuilders', () => {
  it('builds a severity table with escaped cell content', () => {
    const html = buildSeverityTable([
      { file: 'src/a.ts', change: 'Fix <bug>', severity: 'critical' }
    ]);
    expect(html).toContain('vy-severity-table');
    expect(html).toContain('vy-severity--critical');
    expect(html).toContain('Fix &lt;bug&gt;');
  });

  it('builds a design grid', () => {
    const html = buildDesignGrid([
      { title: 'Option A', bodyHtml: '<p>Compact</p>' },
      { title: 'Option B', bodyHtml: '<p>Spacious</p>' }
    ]);
    expect(html).toContain('vy-design-grid');
    expect(html).toContain('vy-design-cell');
  });

  it('builds PR-style change groups', () => {
    const html = buildPrChangeGroups([
      {
        title: 'Auth module',
        severity: 'high',
        files: [{ path: 'auth.ts', summary: 'Token refresh' }]
      }
    ]);
    expect(html).toContain('vy-pr-group');
    expect(html).toContain('vy-pr-file');
  });

  it('builds an edit run summary body', () => {
    const html = buildEditRunSummaryBody({
      promptPreview: 'Refactor providers',
      durationMs: 120_000,
      completedAt: Date.parse('2026-06-06T12:00:00Z'),
      edits: [{ filePath: 'a.ts', additions: 10, deletions: 2 }]
    });
    expect(html).toContain('Summary of changes');
    expect(html).toContain('vy-severity-table');
    expect(html).toContain('Refactor providers');
    expect(html).toContain('vy-run-summary-header');
    expect(html).toContain('Files by directory');
    expect(html).toContain('Template summary — no tokens used');
  });
});
