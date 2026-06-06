/**
 * `report` tool — write self-contained HTML deliverables under
 * `.vyotiq/reports/` inside the active workspace.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import {
  WORKSPACE_DOTDIR,
  REPORTS_SUBDIR,
  MAX_REPORT_HTML_BYTES
} from '@shared/constants.js';
import { buildReportHtml } from './reportTemplate.js';

interface ReportArgs {
  title: string;
  body: string;
  description?: string;
}

function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'report'
  );
}

function fail(id: string, started: number, message: string): ToolResult {
  return {
    id,
    name: 'report',
    ok: false,
    output: message,
    error: message,
    durationMs: Date.now() - started
  };
}

export const reportTool: Tool = {
  name: 'report',
  briefMarkdown: `### Tool: \`report\`

**WHAT it is.** Writes a self-contained HTML deliverable (charts, tables, styled prose) into \`.vyotiq/reports/\` inside the workspace.

**HOW to use it.**

\`\`\`json
{ "name": "report", "arguments": { "title": "Q1 Summary", "body": "<p>…</p>", "description": "Optional subtitle" } }
\`\`\`

**WHY it exists.** For structured deliverables the user can open in their browser — audits, summaries, visual analyses — without polluting project source files.

**WHEN to trigger it.** When the user asks for a report, dashboard, or standalone HTML artifact; or when a long-form answer benefits from rich layout outside the chat timeline.`,
  schema: {
    type: 'function',
    function: {
      name: 'report',
      description:
        'Write a self-contained HTML report under .vyotiq/reports/ in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Document title and filename stem.' },
          body: {
            type: 'string',
            description: 'HTML fragment inserted inside <main> (not a full document).'
          },
          description: { type: 'string', description: 'Optional one-line subtitle.' }
        },
        required: ['title', 'body']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<ReportArgs>;

    if (typeof a.title !== 'string' || a.title.trim().length === 0) {
      return fail(id, started, 'Error: `title` is required.');
    }
    if (typeof a.body !== 'string' || a.body.length === 0) {
      return fail(id, started, 'Error: `body` is required.');
    }
    if (Buffer.byteLength(a.body, 'utf8') > MAX_REPORT_HTML_BYTES) {
      return fail(
        id,
        started,
        `Error: report body exceeds ${MAX_REPORT_HTML_BYTES} bytes. Split into smaller reports or drop verbose sections.`
      );
    }

    const slug = slugifyTitle(a.title.trim());
    const relPath = `${WORKSPACE_DOTDIR}/${REPORTS_SUBDIR}/${slug}.html`;
    const absDir = join(ctx.workspacePath, WORKSPACE_DOTDIR, REPORTS_SUBDIR);
    const absPath = join(absDir, `${slug}.html`);

    try {
      await fs.mkdir(absDir, { recursive: true });
      const html = buildReportHtml({
        title: a.title.trim(),
        body: a.body,
        ...(typeof a.description === 'string' && a.description.trim().length > 0
          ? { description: a.description.trim() }
          : {})
      });
      await fs.writeFile(absPath, html, 'utf8');
      const bytes = Buffer.byteLength(html, 'utf8');

      return {
        id,
        name: 'report',
        ok: true,
        output: `Report saved to ${relPath} (${bytes} bytes).`,
        data: {
          tool: 'report',
          title: a.title.trim(),
          relPath,
          bytes
        },
        durationMs: Date.now() - started
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Error writing report: ${message}`);
    }
  }
};
