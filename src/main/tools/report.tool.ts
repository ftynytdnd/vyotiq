/**
 * `report` tool — writes a self-contained HTML deliverable to
 * `<workspace>/.vyotiq/reports/<slug>-<ts>.html`.
 *
 * Available only to sub-agents that the orchestrator opts into via
 * `<delegate tools="report" />` (see `policy/subagentTools.ts`). The
 * orchestrator never sees this tool in its schema — heavy artifact
 * authoring is delegation work, not reconnaissance work.
 *
 * Returns a typed `ToolData` payload the renderer consumes to draw the
 * `ReportInvocation` card, which surfaces an Open-in-browser button
 * over the existing `tools.openPath` IPC channel.
 */

import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import { describeConfirmFailure } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import {
  resolveCreateInsideWorkspace,
  workspaceRelative
} from './sandbox.js';
import {
  MAX_REPORT_HTML_BYTES,
  REPORTS_SUBDIR,
  WORKSPACE_DOTDIR
} from '@shared/constants.js';
import { buildReportHtml } from './reportTemplate.js';

interface ReportArgs {
  title: string;
  description?: string;
  body: string;
}

const MAX_TITLE_LEN = 200;

export const reportTool: Tool = {
  name: 'report',
  briefMarkdown: `### Tool: \`report\`

**WHAT it is.** A one-shot writer that turns model-authored HTML into a self-contained \`.html\` file under \`.vyotiq/reports/\`. The user opens the file in their default browser via a button on the timeline card. The file has zero remote-network reach (strict CSP); inline SVG charts work fully offline.

**HOW to use it.**

\`\`\`json
{ "name": "report", "arguments": {
  "title": "Workspace Survey \u2014 2026-05-10",
  "description": "Headline counts and a per-extension chart.",
  "body": "<h2>Summary</h2><p>...</p><svg viewBox='0 0 400 200'>...</svg>"
}}
\`\`\`

The \`body\` is an HTML FRAGMENT, not a full document. Do NOT include \`<html>\`, \`<head>\`, or \`<body>\` \u2014 the host wraps your fragment in a styled shell. Do NOT include \`<script src=\` or \`<link rel="stylesheet" href=\` to remote URLs; the saved document blocks every remote fetch.

**Charts.** Emit inline \`<svg>\` directly in the body. Smallest payloads, no JS. Good for simple bars / pies / sparklines.

**WHY it exists.** \`edit\` produces source files; \`report\` produces deliverables. A report is a stable artifact the user can share or open later. Using \`edit\` for HTML reports is wrong: it pollutes the user's workspace tree, gives no Open-in-browser affordance, and skips the report shell (CSP, base styles, footer).

**WHEN to trigger it.** When the orchestrator's \`<delegate>\` task asks for a report, summary, dashboard, survey, or any other "produce a deliverable" outcome. Call this tool exactly once per delegation. Do NOT use it for code edits, scratch HTML, or in-progress drafts.

**Rules.**
- \`title\` required, \u2264 200 chars.
- \`body\` required, \u2264 ${(MAX_REPORT_HTML_BYTES / (1024 * 1024)).toFixed(0)} MB.
- Without \`allowFileWrites\` permission the user is asked to confirm.
- Path is auto-generated; you cannot pick the filename.`,
  schema: {
    type: 'function',
    function: {
      name: 'report',
      description:
        'Write a self-contained HTML report to .vyotiq/reports/. Returns the workspace-relative path; the renderer surfaces an Open-in-browser button.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Doc title (also <h1> and <title>).' },
          description: { type: 'string', description: 'Optional one-line subtitle.' },
          body: {
            type: 'string',
            description:
              'HTML fragment. No <html>/<head>/<body>. Allowed: <svg>, <script>, <style>, all standard semantic tags.'
          }
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
      return failure(id, started, 'Error: `title` is required.', 'missing title');
    }
    if (a.title.length > MAX_TITLE_LEN) {
      return failure(
        id,
        started,
        `Error: \`title\` is too long (${a.title.length} > ${MAX_TITLE_LEN}).`,
        'title too long'
      );
    }
    if (typeof a.body !== 'string' || a.body.length === 0) {
      return failure(id, started, 'Error: `body` is required.', 'missing body');
    }
    if (a.body.length > MAX_REPORT_HTML_BYTES) {
      return failure(
        id,
        started,
        `Error: \`body\` exceeds the ${(MAX_REPORT_HTML_BYTES / (1024 * 1024)).toFixed(0)} MB cap (${a.body.length} bytes). Split the report into smaller artifacts or drop verbose code blocks.`,
        'body too large'
      );
    }
    if (a.description !== undefined && typeof a.description !== 'string') {
      return failure(id, started, 'Error: `description` must be a string when set.', 'invalid description');
    }

    // Compose the workspace-relative path. Slug the title, append a
    // second-precision timestamp; on collision the surrounding write
    // loop appends a 4-byte hex suffix.
    const slug = slugify(a.title);
    const ts = formatTimestamp(new Date());
    const baseName = `${slug || 'report'}-${ts}`;
    const dirRel = `${WORKSPACE_DOTDIR}/${REPORTS_SUBDIR}`;

    let abs: string;
    try {
      abs = await resolveUniquePath(ctx.workspacePath, dirRel, baseName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(id, started, `Sandbox error: ${msg}`, msg);
    }
    const relForDisplay = workspaceRelative(ctx.workspacePath, abs);

    if (!ctx.permissions.allowFileWrites) {
      const outcome = await ctx.confirm(
        `Agent V wants to write a report at ${relForDisplay}. Allow?`
      );
      if (!outcome.approved) {
        // Audit fix H-04: surface precise failure reason.
        const desc = describeConfirmFailure(outcome.reason, `write report ${relForDisplay}`);
        return failure(id, started, desc.output, desc.error);
      }
    }

    const html = buildReportHtml({
      title: a.title,
      ...(a.description !== undefined ? { description: a.description } : {}),
      body: a.body
    });

    try {
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, html, 'utf8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(id, started, `Write failed: ${msg}`, msg);
    }

    const sizeBytes = Buffer.byteLength(html, 'utf8');
    const sizeKb = (sizeBytes / 1024).toFixed(1);

    return {
      id,
      name: 'report',
      ok: true,
      output: `Wrote report "${a.title}" (${sizeKb} KB) to ${relForDisplay}.`,
      data: {
        tool: 'report',
        title: a.title,
        filePath: relForDisplay,
        sizeBytes
      },
      durationMs: Date.now() - started
    };
  }
};

/**
 * Slugify a title for the on-disk filename. Lowercase, ASCII-only,
 * dash-separated, capped at 60 chars. Non-ASCII letters are dropped
 * rather than transliterated — the timestamp suffix preserves
 * uniqueness, so an unfortunate "????-20260510-142500.html" never
 * happens (the empty slug falls back to the literal "report").
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Compact local-time timestamp suitable for filenames: `YYYYMMDD-HHmmss`.
 * Local-time deliberately — the user reads the filename in their own
 * timezone; UTC would make `vendor-20260510-001500.html` confusing for
 * a user who hit Enter at 6 PM Pacific.
 */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * Resolve the report's absolute path with second-precision timestamp.
 * If the resulting file already exists (sub-second collision: two
 * sub-agents writing the same titled report inside the same second),
 * append a 4-byte hex suffix and try again. We probe up to 4 times
 * before giving up — collisions past that point indicate either a
 * filesystem fault or an unbounded retry loop, both of which deserve
 * a structured failure rather than spinning forever.
 */
async function resolveUniquePath(
  workspaceRoot: string,
  dirRel: string,
  baseName: string
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const suffix = attempt === 0 ? '' : `-${randomBytes(2).toString('hex')}`;
    const fileName = `${baseName}${suffix}.html`;
    const abs = await resolveCreateInsideWorkspace(workspaceRoot, join(dirRel, fileName));
    try {
      await fs.access(abs);
      // File exists — collision. Try again with a fresh suffix.
      continue;
    } catch {
      // ENOENT — the path is free. Use it.
      return abs;
    }
  }
  throw new Error('Could not allocate a unique report filename after 4 attempts.');
}

function failure(id: string, started: number, output: string, error: string): ToolResult {
  return {
    id,
    name: 'report',
    ok: false,
    output,
    error,
    durationMs: Date.now() - started
  };
}
