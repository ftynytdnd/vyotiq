/**
 * Write an auto-generated HTML run summary under `.vyotiq/reports/`.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  WORKSPACE_DOTDIR,
  REPORTS_SUBDIR
} from '@shared/constants.js';
import type { ToolResult } from '@shared/types/tool.js';
import { buildReportHtml } from './reportTemplate.js';
import { buildEditRunSummaryBody } from './reportBodyBuilders.js';
import { slugifyReportSegment } from './reportSlugify.js';
import type { GenerateRunSummaryInput } from '@shared/types/ipc.js';

export async function generateRunSummaryReport(
  input: GenerateRunSummaryInput,
  workspacePath: string
): Promise<ToolResult> {
  const id = randomUUID();
  const started = Date.now();

  if (input.edits.length === 0) {
    return {
      id,
      name: 'report',
      ok: false,
      output: 'No file edits to summarize.',
      error: 'No file edits to summarize.',
      durationMs: Date.now() - started
    };
  }

  const stamp = new Date(input.completedAt).toISOString().slice(0, 16).replace('T', ' ');
  const title = `Run summary — ${stamp}`;
  const slug = `${slugifyReportSegment(title, 48, 'run-summary')}-${input.promptId.slice(0, 8)}`;
  const relPath = `${WORKSPACE_DOTDIR}/${REPORTS_SUBDIR}/${slug}.html`;
  const absDir = join(workspacePath, WORKSPACE_DOTDIR, REPORTS_SUBDIR);
  const absPath = join(absDir, `${slug}.html`);

  const body = buildEditRunSummaryBody({
    promptPreview: input.promptPreview,
    durationMs: input.durationMs,
    completedAt: input.completedAt,
    edits: input.edits,
    ...(input.usageSummary ? { usageSummary: input.usageSummary } : {}),
    ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
    ...(input.modelLabel ? { modelLabel: input.modelLabel } : {})
  });

  const html = buildReportHtml({
    title,
    description: `${input.edits.length} file${input.edits.length === 1 ? '' : 's'} edited`,
    body,
    generatedAt: new Date(input.completedAt).toISOString()
  });

  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(absPath, html, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');

  return {
    id,
    name: 'report',
    ok: true,
    output: `Run summary saved to ${relPath} (${bytes} bytes).`,
    data: {
      tool: 'report',
      title,
      relPath,
      bytes
    },
    durationMs: Date.now() - started
  };
}
