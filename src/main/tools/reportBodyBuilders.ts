/**
 * Pure HTML fragment builders for the `report` tool body.
 * Model-authored reports can use these class names directly; Vyotiq
 * also uses them for auto-generated run summaries.
 */

import { clipRunSummaryPromptPreview } from '@shared/report/deliverables.js';
import { escapeHtmlText } from './reportTemplate.js';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface SeverityTableRow {
  file: string;
  change: string;
  severity: SeverityLevel;
}

export interface DesignGridCell {
  title: string;
  bodyHtml: string;
}

export interface PrChangeGroup {
  title: string;
  severity?: SeverityLevel;
  files: Array<{ path: string; summary: string }>;
}

export interface EditRunSummaryInput {
  promptPreview: string;
  durationMs: number;
  completedAt: number;
  edits: Array<{ filePath: string; additions: number; deletions: number }>;
  usageSummary?: {
    promptTokens: number;
    completionTokens: number;
    cachedPromptTokens?: number;
    cacheCreationTokens?: number;
    reasoningTokens?: number;
  };
  costUsd?: number;
  modelLabel?: string;
}

function severityClass(level: SeverityLevel): string {
  return `vy-severity vy-severity--${level}`;
}

export function buildSeverityTable(rows: SeverityTableRow[]): string {
  const body = rows
    .map(
      (row) =>
        `<tr>` +
        `<td><code>${escapeHtmlText(row.file)}</code></td>` +
        `<td>${escapeHtmlText(row.change)}</td>` +
        `<td><span class="${severityClass(row.severity)}">${escapeHtmlText(row.severity)}</span></td>` +
        `</tr>`
    )
    .join('');
  return (
    `<table class="vy-severity-table">` +
    `<thead><tr><th>File</th><th>Change</th><th>Severity</th></tr></thead>` +
    `<tbody>${body}</tbody></table>`
  );
}

export function buildDesignGrid(cells: DesignGridCell[]): string {
  const items = cells
    .map(
      (cell) =>
        `<article class="vy-design-cell">` +
        `<h3>${escapeHtmlText(cell.title)}</h3>` +
        `${cell.bodyHtml}` +
        `</article>`
    )
    .join('');
  return `<div class="vy-design-grid">${items}</div>`;
}

export function buildPrChangeGroups(groups: PrChangeGroup[]): string {
  return groups
    .map((group) => {
      const severity = group.severity
        ? `<span class="${severityClass(group.severity)}">${escapeHtmlText(group.severity)}</span> `
        : '';
      const files = group.files
        .map(
          (f) =>
            `<li class="vy-pr-file">` +
            `<code>${escapeHtmlText(f.path)}</code>` +
            `<p>${escapeHtmlText(f.summary)}</p>` +
            `</li>`
        )
        .join('');
      return (
        `<section class="vy-pr-group">` +
        `<h3>${severity}${escapeHtmlText(group.title)}</h3>` +
        `<ul>${files}</ul>` +
        `</section>`
      );
    })
    .join('');
}

function inferSeverity(additions: number, deletions: number): SeverityLevel {
  const delta = additions + deletions;
  let level: SeverityLevel = 'low';
  if (delta >= 120) level = 'critical';
  else if (delta >= 40) level = 'high';
  else if (delta >= 8) level = 'medium';
  if (deletions > additions || delta > 100) {
    if (level === 'low') level = 'medium';
    else if (level === 'medium') level = 'high';
    else if (level === 'high') level = 'critical';
  }
  return level;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatWallClock(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function topLevelDir(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const slash = norm.indexOf('/');
  if (slash === -1) return 'Project root';
  return `${norm.slice(0, slash)}/`;
}

function groupEditsByDirectory(
  edits: EditRunSummaryInput['edits']
): PrChangeGroup[] {
  const byDir = new Map<string, EditRunSummaryInput['edits']>();
  for (const e of edits) {
    const dir = topLevelDir(e.filePath);
    const list = byDir.get(dir) ?? [];
    list.push(e);
    byDir.set(dir, list);
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, files]) => ({
      title: dir,
      files: files.map((e) => ({
        path: e.filePath,
        summary: `${e.additions} additions, ${e.deletions} deletions`
      }))
    }));
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function buildUsageFooter(input: EditRunSummaryInput): string {
  const u = input.usageSummary;
  if (!u && input.costUsd === undefined && !input.modelLabel) {
    return (
      `<footer class="vy-run-summary-footer">` +
      `<p><em>Template summary — no tokens used. For a full AI-authored review, enable AI report in Settings.</em></p>` +
      `</footer>`
    );
  }
  const parts: string[] = [];
  if (input.modelLabel) parts.push(`Model: ${escapeHtmlText(input.modelLabel)}`);
  if (u) {
    parts.push(`Tokens in: ${formatTokenCount(u.promptTokens)}`);
    parts.push(`Tokens out: ${formatTokenCount(u.completionTokens)}`);
    if ((u.cachedPromptTokens ?? 0) > 0) {
      parts.push(`Cache read: ${formatTokenCount(u.cachedPromptTokens ?? 0)}`);
    }
    if ((u.cacheCreationTokens ?? 0) > 0) {
      parts.push(`Cache write: ${formatTokenCount(u.cacheCreationTokens ?? 0)}`);
    }
  }
  if (input.costUsd !== undefined && input.costUsd > 0) {
    parts.push(`Estimated cost: ~$${input.costUsd.toFixed(4)}`);
  }
  return (
    `<footer class="vy-run-summary-footer">` +
    (parts.length > 0 ? `<p>${parts.join(' · ')}</p>` : '') +
    `<p><em>Template summary — no LLM tokens used for this report.</em></p>` +
    `</footer>`
  );
}

/** Auto-generated body for post-edit run summaries. */
export function buildEditRunSummaryBody(input: EditRunSummaryInput): string {
  const rows: SeverityTableRow[] = input.edits.map((e) => ({
    file: e.filePath,
    change: `+${e.additions} / −${e.deletions} lines`,
    severity: inferSeverity(e.additions, e.deletions)
  }));

  const totalAdds = input.edits.reduce((n, e) => n + e.additions, 0);
  const totalDels = input.edits.reduce((n, e) => n + e.deletions, 0);
  const prompt = clipRunSummaryPromptPreview(input.promptPreview);
  const durationLabel = formatDuration(input.durationMs);
  const completedLabel = formatWallClock(input.completedAt);

  return (
    `<header class="vy-run-summary-header">` +
    `<p><strong>Run duration</strong> — ${escapeHtmlText(durationLabel)}</p>` +
    `<p><strong>Completed</strong> — ${escapeHtmlText(completedLabel)}</p>` +
    (prompt.length > 0
      ? `<p><strong>Prompt</strong> — ${escapeHtmlText(prompt)}</p>`
      : '') +
    `</header>` +
    `<p class="vy-run-summary-stats">` +
    `<strong>${input.edits.length}</strong> file${input.edits.length === 1 ? '' : 's'} · ` +
    `<strong>+${totalAdds}</strong> / <strong>−${totalDels}</strong> lines` +
    `</p>` +
    `<h2>Summary of changes</h2>` +
    buildSeverityTable(rows) +
    `<h2>Files by directory</h2>` +
    buildPrChangeGroups(groupEditsByDirectory(input.edits)) +
    buildUsageFooter(input)
  );
}
