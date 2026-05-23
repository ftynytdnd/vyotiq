/**
 * `search` tool — dual-mode.
 *
 *   mode: "local"  → fast-glob + line-grep across the workspace.
 *   mode: "web"    → calls the user-configured search endpoint. When
 *                    `allowAuto` is off (default), the user is asked
 *                    to confirm each outbound query. A workspace-path
 *                    leak in the query is a hard refusal, prompt-or-no.
 *
 * The harness controls when to invoke web search. Local search is the default
 * to honor "Offline first" and the privacy directive.
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import fg from 'fast-glob';
import type { Tool } from './types.js';
import { describeConfirmFailure } from './types.js';
import type { SearchMatch, ToolResult } from '@shared/types/tool.js';
import { realpathInsideWorkspace, workspaceRelative } from './sandbox.js';
import { getSettings } from '../settings/settingsStore.js';

interface SearchArgs {
  mode: 'local' | 'web';
  query: string;
  path?: string;
  glob?: string;
  maxResults?: number;
}

const DEFAULT_GLOB = '**/*.{ts,tsx,js,jsx,md,mdx,json,css,scss,html,py,go,rs,java,cpp,c,h,hpp,toml,yml,yaml}';
const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/.next/**'];

export const searchTool: Tool = {
  name: 'search',
  briefMarkdown: `### Tool: \`search\`

**WHAT it is.** Two-mode search. \`local\` greps files in the workspace. \`web\` queries a configured external search endpoint (off by default).

**HOW to use it.**

Local:
\`\`\`json
{ "name": "search", "arguments": { "mode": "local", "query": "createMainWindow", "glob": "src/**/*.ts" } }
\`\`\`

Web:
\`\`\`json
{ "name": "search", "arguments": { "mode": "web", "query": "tailwind v4 @theme directive" } }
\`\`\`

**WHY it exists.** Offline research is faster, private, and grounded; online research is the fallback when the local codebase is insufficient.

**WHEN to trigger it.**
- Use \`local\` first whenever you need to find a symbol or string in the project.
- Only fall back to \`web\` when the local codebase is genuinely insufficient. When \`allowAuto\` is off (default), the user will be asked to confirm the web search.
- NEVER pass file contents into \`web\` queries — only the user's question.`,
  schema: {
    type: 'function',
    function: {
      name: 'search',
      description: 'Local file grep (default) or web search (when permitted).',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['local', 'web'] },
          query: { type: 'string' },
          path: { type: 'string', description: 'Local mode: relative subpath to search.' },
          glob: { type: 'string', description: 'Local mode: glob filter.' },
          maxResults: { type: 'number' }
        },
        required: ['mode', 'query']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<SearchArgs>;
    if (typeof a.query !== 'string' || !a.query.trim()) {
      return fail(id, started, 'Error: `query` is required.', 'missing query');
    }
    if (a.mode !== 'local' && a.mode !== 'web') {
      return fail(
        id,
        started,
        `Error: unknown search mode "${String(a.mode)}" — use "local" or "web".`,
        'invalid mode'
      );
    }
    const max = typeof a.maxResults === 'number' ? Math.max(1, Math.min(200, a.maxResults)) : 50;

    if (a.mode === 'web') {
      // Privacy guard FIRST, before the consent prompt. A workspace-path
      // leak is a hard refusal — we do NOT want to ask the user "are
      // you sure you want to send /home/me/project/src/main.ts to a
      // search endpoint?" because the leak itself is the bug.
      const ws = ctx.workspacePath?.trim();
      if (ws && a.query.includes(ws)) {
        return fail(
          id,
          started,
          'Refusing web search: query contains the workspace path. ' +
          'Web queries must be plain user prose, not paths or file contents.',
          'workspace leak'
        );
      }
      if (!ctx.permissions.allowAuto) {
        const outcome = await ctx.confirm(
          `Agent V wants to run a web search:\n\n"${a.query}"\n\nAllow?`
        );
        if (!outcome.approved) {
          // Audit fix H-04: surface the precise failure reason instead of
          // always claiming the user denied — the prompt may have timed
          // out, been aborted, or had no UI to surface against.
          const desc = describeConfirmFailure(outcome.reason, 'run web search');
          return fail(id, started, desc.output, desc.error);
        }
      }
      return await runWebSearch(id, started, a.query, max, ctx.signal);
    }

    // local
    let rootAbs: string;
    try {
      rootAbs = await realpathInsideWorkspace(ctx.workspacePath, a.path ?? '.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Sandbox error: ${msg}`, msg);
    }

    // Decide whether `path` resolves to a file or a directory. fast-glob's
    // `cwd` MUST be a directory or it throws `ENOTDIR`. When the model
    // (reasonably) passes a file path, grep that single file directly and
    // skip the glob walk entirely.
    let files: string[];
    try {
      const stat = await fs.stat(rootAbs);
      if (stat.isFile()) {
        files = [rootAbs];
      } else if (stat.isDirectory()) {
        const glob = a.glob ?? DEFAULT_GLOB;
        try {
          files = await fg(glob, {
            cwd: rootAbs,
            ignore: DEFAULT_IGNORE,
            absolute: true,
            dot: false,
            onlyFiles: true,
            // Match the containment rule the rest of the host enforces.
            // Following workspace-rooted symlinks here would let `search`
            // grep the contents of files outside the sandbox and surface
            // their paths/snippets to the model — same shape as the
            // `inlineFiles` privacy boundary. Keep results symlink-
            // bounded so search results never carry data the user did
            // not intend to expose.
            followSymbolicLinks: false
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return fail(id, started, `Glob error: ${msg}`, msg);
        }
      } else {
        return fail(
          id,
          started,
          `Path is neither file nor directory: ${a.path ?? '.'}`,
          'unsupported path type'
        );
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        return fail(
          id,
          started,
          `Path not found: ${a.path ?? '.'}`,
          'path not found'
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Stat error: ${msg}`, msg);
    }

    const re = buildLooseRegex(a.query);
    const matches: SearchMatch[] = [];
    let aborted = false;
    for (const file of files) {
      // Honor the run-scoped signal between file reads so a user Stop
      // (or a supersede on the orchestrator side) terminates the walk
      // immediately rather than burning through every remaining
      // candidate in a large monorepo. The match-cap break above only
      // triggers once `max` hits have already landed — without this
      // gate a fresh signal would still let the loop scan every
      // workspace source file before returning.
      if (ctx.signal.aborted) {
        aborted = true;
        break;
      }
      if (matches.length >= max) break;
      let txt: string;
      try {
        txt = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const rel = workspaceRelative(ctx.workspacePath, file);
      const lines = txt.split('\n');
      for (let i = 0; i < lines.length && matches.length < max; i++) {
        if (re.test(lines[i]!)) {
          matches.push({
            path: rel,
            line: i + 1,
            preview: lines[i]!.trim().slice(0, 240)
          });
        }
      }
    }
    if (aborted) {
      return fail(id, started, 'Local search aborted.', 'aborted');
    }
    const truncated = matches.length >= max;

    return {
      id,
      name: 'search',
      ok: true,
      output: matches.length > 0
        ? `# Local search for "${a.query}" — ${matches.length} hits${truncated ? ' (truncated)' : ''}\n` +
        matches.map((m) => `${m.path}:${m.line}\t${m.preview}`).join('\n')
        : `# No local matches for "${a.query}".`,
      data: {
        tool: 'search',
        mode: 'local',
        query: a.query,
        matches,
        truncated
      },
      durationMs: Date.now() - started
    };
  }
};

function buildLooseRegex(query: string): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

async function runWebSearch(id: string, started: number, query: string, max: number, signal: AbortSignal): Promise<ToolResult> {
  const settings = await getSettings();
  const endpoint = settings.webSearchEndpoint?.trim();
  if (!endpoint) {
    return fail(
      id,
      started,
      'No web search endpoint configured. Set one in Settings → Web Search.',
      'no endpoint'
    );
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return fail(id, started, `Invalid web search endpoint: ${endpoint}`, 'invalid url');
  }
  // Privacy hardening: refuse plain http:// for non-localhost endpoints so a
  // user query can never be MITM-ed across the open internet.
  const isLocalhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !isLocalhost) {
    return fail(
      id,
      started,
      `Refusing to send web search to non-HTTPS endpoint: ${endpoint}. ` +
      'Use https:// (or a localhost address for local providers).',
      'insecure scheme'
    );
  }
  // SSRF defense-in-depth: reject endpoints whose hostname parses as a
  // private / link-local / loopback IP. The Prime Directives forbid
  // outbound writes to the local network, and a user-configured endpoint
  // is a natural way for that invariant to break (e.g. accidentally
  // pointing at `https://192.168.1.1/admin` or cloud-metadata addresses
  // like `169.254.169.254`). Localhost is still permitted for local
  // providers — that's why the check happens AFTER the localhost
  // short-circuit above.
  if (!isLocalhost && isPrivateHost(url.hostname)) {
    return fail(
      id,
      started,
      `Refusing to send web search to a private / link-local address: ${url.hostname}. ` +
      'Web search endpoints must be public hosts.',
      'private host'
    );
  }
  try {
    url.searchParams.set('q', query);
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) {
      return fail(id, started, `Web search HTTP ${res.status}.`, `http ${res.status}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    // Audit fix 2026-04-P2-3: stream-read the response body with a hard
    // 1 MB cap. The previous shape called `res.text()` / `res.json()`,
    // which buffer the ENTIRE upstream body into memory before slicing
    // to 4 000 chars — a misconfigured (or hostile) endpoint replying
    // with a 1 GB JSON payload would OOM the main process. Streaming
    // with cancellation keeps the buffer bounded and aborts the rest
    // of the body fetch the moment we hit the cap.
    const RAW_BODY_CAP = 1024 * 1024;
    const raw = await readBodyWithCap(res, RAW_BODY_CAP);
    let body: string;
    if (contentType.includes('application/json')) {
      try {
        const json = JSON.parse(raw) as unknown;
        // Many search APIs return { data: [...] } / { results: [...] } /
        // { items: [...] }. Honor `max` by truncating that array if present.
        let trimmed: unknown = json;
        if (json && typeof json === 'object') {
          const obj = json as Record<string, unknown>;
          for (const key of ['data', 'results', 'items']) {
            const val = obj[key];
            if (Array.isArray(val)) {
              trimmed = { ...obj, [key]: val.slice(0, max) };
              break;
            }
          }
        }
        body = JSON.stringify(trimmed, null, 2).slice(0, 4000);
      } catch {
        // The cap may have truncated mid-token, leaving JSON.parse
        // unable to finish. Fall back to the raw text view, sliced
        // to the result cap. We DO NOT re-fetch the body: the cap
        // is structural, not a retry signal.
        body = raw.slice(0, 4000);
      }
    } else {
      body = raw.slice(0, 4000);
    }
    return {
      id,
      name: 'search',
      ok: true,
      output: `# Web search for "${query}" (truncated)\n${body}`,
      data: {
        tool: 'search',
        mode: 'web',
        query,
        webBody: body,
        webContentType: contentType,
        truncated: true
      },
      durationMs: Date.now() - started
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(id, started, `Web search failed: ${msg}`, msg);
  }
}

function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'search', ok: false, output, error, durationMs: Date.now() - started };
}

/**
 * Stream-read a `fetch` response body into a UTF-8 string, hard-capped
 * at `maxBytes`. Once the cap is hit the underlying reader is cancelled
 * so the rest of the upstream body is dropped on the floor — important
 * for the audit-fix 2026-04-P2-3 contract: a 1 GB JSON reply from a
 * mis-configured search endpoint must NOT pin the main thread until it
 * finishes downloading.
 *
 * Falls back to `res.text()` (with a defensive slice) when `res.body`
 * is unavailable. That branch is only hit by exotic Response objects
 * (custom mocks, HEAD-shaped responses) — Node 22 / undici always
 * exposes `.body` for non-empty replies.
 *
 * The TextDecoder runs in stream mode so multi-byte UTF-8 codepoints
 * straddling a chunk boundary aren't replaced with U+FFFD; the final
 * `decoder.decode()` flushes the trailing state.
 */
async function readBodyWithCap(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let out = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      if (value.byteLength <= room) {
        total += value.byteLength;
        out += decoder.decode(value, { stream: true });
        continue;
      }
      // Cap hit — decode only the bytes that fit, then cancel.
      if (room > 0) {
        out += decoder.decode(value.subarray(0, room), { stream: true });
        total += room;
      }
      try {
        await reader.cancel();
      } catch {
        /* cancel failures are safe to ignore — body bytes still drop */
      }
      break;
    }
  } finally {
    // Flush any pending multi-byte tail held by the streaming decoder.
    out += decoder.decode();
  }
  return out;
}

/**
 * Returns `true` when `host` parses as a private / link-local / loopback
 * IP address that must NOT be reachable through the outbound web-search
 * path. Covers:
 *
 *   - RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *   - RFC6598 (carrier-grade NAT: 100.64.0.0/10)
 *   - RFC3927 (link-local: 169.254.0.0/16 — includes cloud metadata)
 *   - RFC5735 (loopback: 127.0.0.0/8)
 *   - IPv4 0.0.0.0/8 "this network"
 *   - IPv6 loopback (`::1`), link-local (`fe80::/10`), and
 *     unique-local (`fc00::/7`) ranges
 *
 * Non-IP hostnames are NOT filtered here — a malicious DNS entry that
 * resolves to a private IP is a DNS-rebinding concern that would require
 * a full resolver + connect-time check to close. This is defense in
 * depth for the most common misconfiguration (pasting an intranet URL
 * into the Settings box), not a full SSRF firewall.
 */
function isPrivateHost(host: string): boolean {
  // Strip optional brackets around IPv6 literals.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // IPv4 dotted quad.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (v4) {
    const parts = v4.slice(1).map((p) => Number(p));
    if (parts.some((n) => n < 0 || n > 255 || Number.isNaN(n))) return false;
    const [a = 0, b = 0] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 — only handle the obvious private prefixes by string match.
  // Full IPv6 range parsing is overkill for this defense-in-depth check.
  const lower = bare.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
    lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique-local

  return false;
}
