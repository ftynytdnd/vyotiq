/**
 * `edit` tool — surgical exact-match edits. Refuses if the old_string is not
 * unique unless `replace_all: true`. Also handles file creation when `create:
 * true`.
 *
 * Returns a diff summary { additions, deletions, filesChanged } for the
 * FileEditCard in the renderer.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext } from './types.js';
import { describeConfirmFailure } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import type { EditApprovalPayload } from '@shared/types/ipc.js';
import {
  realpathInsideWorkspace,
  resolveCreateInsideWorkspace,
  workspaceRelative
} from './sandbox.js';
import { computeDiffHunks } from '@shared/text/diff/computeDiffHunks.js';
import {
  countOccurrencesFlexible,
  findFlexible,
  suggestSimilarLines
} from './editHelpers.js';
import { recordChange } from '../checkpoints/index.js';

interface EditArgs {
  path: string;
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  create?: boolean;
  content?: string;
}

interface DiffStats {
  additions: number;
  deletions: number;
}

function diffStats(before: string, after: string): DiffStats {
  // Simple line-based count: any line not present (by content) in the other side counts.
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const beforeSet = new Map<string, number>();
  const afterSet = new Map<string, number>();
  for (const l of beforeLines) beforeSet.set(l, (beforeSet.get(l) ?? 0) + 1);
  for (const l of afterLines) afterSet.set(l, (afterSet.get(l) ?? 0) + 1);
  let additions = 0;
  let deletions = 0;
  for (const [line, count] of afterSet) {
    const prev = beforeSet.get(line) ?? 0;
    if (count > prev) additions += count - prev;
  }
  for (const [line, count] of beforeSet) {
    const next = afterSet.get(line) ?? 0;
    if (count > next) deletions += count - next;
  }
  return { additions, deletions };
}

export const editTool: Tool = {
  name: 'edit',
  briefMarkdown: `### Tool: \`edit\`

**WHAT it is.** A surgical file editor. Performs exact-match \`oldString\` → \`newString\` substitutions, or creates a new file with full \`content\`.

**HOW to use it.**

Edit existing file:
\`\`\`json
{ "name": "edit", "arguments": {
  "path": "src/index.ts",
  "oldString": "console.log(\\"hi\\");",
  "newString": "console.log(\\"hello\\");"
}}
\`\`\`

Replace all occurrences:
\`\`\`json
{ "name": "edit", "arguments": { "path": "...", "oldString": "...", "newString": "...", "replaceAll": true }}
\`\`\`

Create a new file:
\`\`\`json
{ "name": "edit", "arguments": { "path": "src/new.ts", "create": true, "content": "..." }}
\`\`\`

**WHY it exists.** To alter files surgically without destroying surrounding code. Always read the file with \`read\` first to ensure your \`oldString\` is unique and exact.

**WHEN to trigger it.** Whenever you need to modify a file. Never use \`bash\` to write files — that bypasses safety and produces no diff.

**Rules.**
- \`oldString\` MUST match exactly, including whitespace.
- If \`oldString\` is not unique you MUST set \`replaceAll: true\` or expand the context until it IS unique.
- \`create: true\` requires the file to NOT already exist.
- When \`allowAuto\` is off (default), the user will be asked to confirm each write.`,
  schema: {
    type: 'function',
    function: {
      name: 'edit',
      description:
        'Edit a file surgically (oldString -> newString) or create a new file. Returns a diff summary.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to workspace root.' },
          oldString: { type: 'string', description: 'Exact text to replace (when editing).' },
          newString: { type: 'string', description: 'Replacement text.' },
          replaceAll: {
            type: 'boolean',
            description: 'Replace all occurrences. Default false.'
          },
          create: { type: 'boolean', description: 'Create a new file with `content`.' },
          content: {
            type: 'string',
            description: 'Full file contents (only with `create: true`).'
          }
        },
        required: ['path']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<EditArgs>;
    if (typeof a.path !== 'string' || !a.path.trim()) {
      return failure(id, started, 'Error: `path` is required.', 'missing path');
    }

    // Cache for the file's existing body. Populated when the
    // strict-approval path eagerly reads the body to compute the
    // preview diff, so the MODIFY branch below can skip a redundant
    // `fs.readFile` and use this buffer directly. Always `null` on
    // the non-strict path.
    let preReadOriginal: string | null = null;

    let abs: string;
    try {
      // Create vs modify use DIFFERENT sandbox resolvers:
      //
      //   - create: `resolveCreateInsideWorkspace` walks up from the
      //     not-yet-existing target until it finds an existing ancestor
      //     on disk and real-paths THAT. A plain lexical resolve (what
      //     this branch used to do) lets a pre-existing in-workspace
      //     symlink like `vendor → /etc` redirect the write outside
      //     the sandbox — classic symlinked-ancestor escape. The new
      //     helper rejects that case by design.
      //
      //   - modify: `realpathInsideWorkspace` canonicalises the target
      //     itself. Safe for existing files because the target DOES
      //     exist and `realpath` follows every symlink on the path.
      abs =
        a.create === true
          ? await resolveCreateInsideWorkspace(ctx.workspacePath, a.path)
          : await realpathInsideWorkspace(ctx.workspacePath, a.path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(id, started, `Sandbox error: ${msg}`, msg);
    }

    // Approval gate. Two layers feed it:
    //   1. `permissions.allowAuto === false` (the default) — prompt
    //      the user once per call via the text-only confirm.
    //   2. `ctx.strictApprovals === true` (per-workspace toggle) —
    //      every edit/delete pauses the run and asks for a full diff
    //      approval, REGARDLESS of `allowAuto`. The strict path always
    //      wins.
    //
    // Under `strictApprovals`, we route through `ctx.confirmEdit` so
    // the renderer shows the full diff (`EditApprovalDialog`) instead
    // of a text-only "Allow?" prompt. The diff is synthesized HERE
    // from the same buffers the modify/create branch will write, so
    // the user sees byte-identical content to what would land.
    //
    // The `allowAuto === false` text-only confirm exists for the
    // non-strict workspace path: the user opted out of full auto so
    // every write asks "Allow?" without the full diff round-trip.
    if (ctx.strictApprovals) {
      // Build the structured preview eagerly. For `modify` we need to
      // read the existing file body up-front to compute hunks +
      // postBody; that read is the same one the modify branch would
      // perform below, so the cost is amortized rather than doubled
      // (we cache `original` into `preReadOriginal` and reuse it).
      const previewResult = await buildApprovalPayload({
        a,
        abs,
        ctx,
        verb: a.create ? 'create' : 'modify'
      });
      if (previewResult.kind === 'error') {
        return failure(id, started, previewResult.output, previewResult.error);
      }
      const decision = await ctx.confirmEdit(previewResult.payload);
      if (!decision.approved) {
        return failure(id, started, `User denied write to ${a.path}.`, 'permission denied');
      }
      // Stash any pre-read body the synthesizer already did so the
      // MODIFY branch below can skip a second `fs.readFile`.
      preReadOriginal = previewResult.preReadOriginal;
    } else if (!ctx.permissions.allowAuto) {
      const verb = a.create ? 'create' : 'modify';
      const outcome = await ctx.confirm(
        `Agent V wants to ${verb} ${a.path}. Allow?`
      );
      if (!outcome.approved) {
        // Audit fix H-04: surface the precise failure reason instead
        // of always claiming the user denied the write.
        const desc = describeConfirmFailure(outcome.reason, `${verb} ${a.path}`);
        return failure(id, started, desc.output, desc.error);
      }
    }

    // CREATE
    if (a.create === true) {
      if (typeof a.content !== 'string') {
        return failure(id, started, 'Error: `content` is required when `create: true`.', 'missing content');
      }
      try {
        await fs.mkdir(dirname(abs), { recursive: true });
        // Atomic existence check + write. The previous shape ran
        // `fs.access` and then `fs.writeFile(..., 'utf8')` — a classic
        // TOCTOU window: a concurrent process (another agent, an
        // external editor) creating the file between the access
        // failure and the write would have its content silently
        // clobbered. The host's `recordChange` would then capture
        // `kind: 'create'` with no `preContent`, so a later Reject
        // would unlink the file and destroy the externally-created
        // body. Using the `wx` flag pushes the existence check into
        // the kernel: `writeFile` rejects with `EEXIST` when the
        // target already exists, and the rejection is the same
        // observable failure the user-facing surface promised before.
        await fs.writeFile(abs, a.content, { encoding: 'utf8', flag: 'wx' });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'EEXIST') {
          return failure(
            id,
            started,
            `Refusing to create: file already exists at ${a.path}.`,
            'exists'
          );
        }
        const msg = err instanceof Error ? err.message : String(err);
        return failure(id, started, `Create failed: ${msg}`, msg);
      }
      const stats = diffStats('', a.content);
      const rel = workspaceRelative(ctx.workspacePath, abs);
      // Checkpoint: record the post-state so a later Reject/revert can
      // unlink the file. Best-effort — a checkpoint-store failure must
      // not mask a successful write from the model's perspective.
      try {
        await recordChange({
          runId: ctx.runId,
          conversationId: ctx.conversationId,
          workspaceId: ctx.workspaceId,
          filePath: rel,
          kind: 'create',
          postContent: a.content,
          additions: stats.additions,
          deletions: 0,
          source: 'edit',
          ...(ctx.subagentId ? { subagentId: ctx.subagentId } : {}),
          emit: ctx.emit
        });
      } catch {
        /* logged inside the store */
      }
      return {
        id,
        name: 'edit',
        ok: true,
        output: `Created ${a.path} (+${stats.additions} lines).`,
        data: {
          tool: 'edit',
          filePath: rel,
          additions: stats.additions,
          deletions: 0,
          created: true,
          createdContent: a.content
        },
        durationMs: Date.now() - started
      };
    }

    // MODIFY
    if (typeof a.oldString !== 'string' || typeof a.newString !== 'string') {
      return failure(
        id,
        started,
        'Error: provide either `create: true` + `content`, or `oldString` + `newString`.',
        'invalid args'
      );
    }
    if (a.oldString.length === 0) {
      // An empty `oldString` is never a usable anchor — it would match
      // at every position in the file, so the downstream occurrence
      // count + suggested-lines diagnostic would either misclassify
      // as "no match" (after `findFlexible` returns null) or "many
      // matches" depending on the helper's behaviour. Surface the
      // structural error directly so the model can self-correct
      // instead of wasting a turn parsing a generic miss. Review
      // finding M8.
      return failure(
        id,
        started,
        'Error: `oldString` cannot be empty. Provide the exact text to replace.',
        'empty oldString'
      );
    }
    if (a.oldString === a.newString) {
      return failure(id, started, 'Error: `oldString` and `newString` are identical (no-op).', 'no-op');
    }

    let original: string;
    if (preReadOriginal !== null) {
      // Reuse the body we read inside `buildApprovalPayload`. The
      // approval gate runs BEFORE this branch when `strictApprovals`
      // is on, so a successful preview round-trip means we already
      // have the bytes — re-reading would just double the I/O.
      original = preReadOriginal;
    } else {
      try {
        original = await fs.readFile(abs, 'utf8');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return failure(id, started, `Cannot read ${a.path}: ${msg}`, msg);
      }
    }

    const occ = countOccurrencesFlexible(original, a.oldString);
    if (occ === 0) {
      // Build an actionable diagnostic instead of a one-line "no match".
      // Models stuck on this error otherwise burn many turns retrying the
      // same string. The hints almost always identify the cause: line-
      // number prefix accidentally pasted from `read`, whitespace drift,
      // or wrong line.
      const totalLines = original.split('\n').length;
      const suggestions = suggestSimilarLines(original, a.oldString, 3);
      const hintBlock =
        suggestions.length > 0
          ? `\nClosest existing lines (by token overlap):\n${suggestions.join('\n')}`
          : '';
      return failure(
        id,
        started,
        `\`oldString\` not found in ${a.path} (${totalLines} lines).\n` +
        `Re-read the file with \`read\` and copy the exact content. ` +
        `Note: \`read\`'s output prefixes each line with \`NNNNN\\t\` for ` +
        `navigation — the prefix is NOT part of the file and must be ` +
        `stripped before passing to \`edit\`.${hintBlock}`,
        'no match'
      );
    }
    if (occ > 1 && !a.replaceAll) {
      return failure(
        id,
        started,
        `\`oldString\` matches ${occ} locations in ${a.path}. Either set \`replaceAll: true\` or expand the context to a unique match.`,
        'ambiguous'
      );
    }

    let updated: string;
    if (a.replaceAll) {
      // ReplaceAll under flexible matching: walk the original, splicing
      // each occurrence in turn so per-match index translation is
      // self-consistent.
      let work = original;
      let cursor = 0;
      let safety = occ + 8; // guard against pathological infinite loops.
      while (safety-- > 0) {
        const m = findFlexible(work.slice(cursor), a.oldString);
        if (!m) break;
        const absIdx = cursor + m.index;
        work = work.slice(0, absIdx) + a.newString + work.slice(absIdx + m.length);
        cursor = absIdx + a.newString.length;
      }
      updated = work;
    } else {
      const m = findFlexible(original, a.oldString);
      if (!m) {
        // Should be unreachable since `occ > 0`, but stay defensive.
        return failure(id, started, `Match disappeared between count and replace.`, 'race');
      }
      updated = original.slice(0, m.index) + a.newString + original.slice(m.index + m.length);
    }

    try {
      await fs.writeFile(abs, updated, 'utf8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failure(id, started, `Write failed: ${msg}`, msg);
    }

    const stats = diffStats(original, updated);
    const hunks = computeDiffHunks(original, updated);
    const rel = workspaceRelative(ctx.workspacePath, abs);
    // Checkpoint: snapshot pre + post bodies so the user can revert
    // this edit later. Best-effort — store failures must not mask the
    // successful write.
    try {
      await recordChange({
        runId: ctx.runId,
        conversationId: ctx.conversationId,
        workspaceId: ctx.workspaceId,
        filePath: rel,
        kind: 'modify',
        preContent: original,
        postContent: updated,
        additions: stats.additions,
        deletions: stats.deletions,
        hunks,
        source: 'edit',
        ...(ctx.subagentId ? { subagentId: ctx.subagentId } : {}),
        emit: ctx.emit
      });
    } catch {
      /* logged inside the store */
    }
    return {
      id,
      name: 'edit',
      ok: true,
      output: `Edited ${a.path} (+${stats.additions} -${stats.deletions}, ${occ} occurrence${occ === 1 ? '' : 's'} replaced).`,
      data: {
        tool: 'edit',
        filePath: rel,
        additions: stats.additions,
        deletions: stats.deletions,
        created: false,
        hunks,
        replacedOccurrences: a.replaceAll ? occ : 1
      },
      durationMs: Date.now() - started
    };
  }
};

/**
 * Build the structured `EditApprovalPayload` shown to the user when
 * `strictApprovals` is on. Two outcomes:
 *
 *   - `{ kind: 'ok', payload, preReadOriginal }` — the dialog has
 *     everything it needs; the caller forwards `payload` to
 *     `ctx.confirmEdit` and reuses `preReadOriginal` in the MODIFY
 *     branch so the file isn't read twice.
 *   - `{ kind: 'error', output, error }` — bail-out shape. The caller
 *     converts this into the same `failure(...)` shape the rest of
 *     the tool returns on early exits. Errors here are the same ones
 *     the MODIFY branch would surface (missing file, no match, etc.)
 *     just pulled forward so the user isn't shown a preview that
 *     can never apply.
 *
 * For `modify` we synthesize the post-state by applying the exact
 * same find/replace transformation the write branch will. For
 * `create` we use the literal `content` argument. For `delete` we
 * use the existing file body as `preBody` and leave `postBody`
 * undefined.
 */
async function buildApprovalPayload(opts: {
  a: Partial<EditArgs>;
  abs: string;
  ctx: ToolContext;
  verb: 'create' | 'modify';
}): Promise<
  | { kind: 'ok'; payload: EditApprovalPayload; preReadOriginal: string | null }
  | { kind: 'error'; output: string; error: string }
> {
  const { a, abs, ctx, verb } = opts;
  const filePath = workspaceRelative(ctx.workspacePath, abs);
  const runId = ctx.runId;
  const subagentSlot = ctx.subagentId ? { subagentId: ctx.subagentId } : {};

  if (verb === 'create') {
    if (typeof a.content !== 'string') {
      return {
        kind: 'error',
        output: 'Error: `content` is required when `create: true`.',
        error: 'missing content'
      };
    }
    const additions = a.content.length === 0 ? 0 : a.content.split('\n').length;
    return {
      kind: 'ok',
      preReadOriginal: null,
      payload: {
        kind: 'edit-approval',
        filePath,
        operation: 'create',
        postBody: a.content,
        additions,
        deletions: 0,
        runId,
        ...subagentSlot
      }
    };
  }

  // verb === 'modify'
  if (typeof a.oldString !== 'string' || typeof a.newString !== 'string') {
    return {
      kind: 'error',
      output:
        'Error: provide either `create: true` + `content`, or `oldString` + `newString`.',
      error: 'invalid args'
    };
  }
  if (a.oldString.length === 0) {
    // Same rationale as the post-approval branch — review finding M8.
    return {
      kind: 'error',
      output: 'Error: `oldString` cannot be empty. Provide the exact text to replace.',
      error: 'empty oldString'
    };
  }
  if (a.oldString === a.newString) {
    return {
      kind: 'error',
      output: 'Error: `oldString` and `newString` are identical (no-op).',
      error: 'no-op'
    };
  }

  let original: string;
  try {
    original = await fs.readFile(abs, 'utf8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'error', output: `Cannot read ${a.path}: ${msg}`, error: msg };
  }

  const occ = countOccurrencesFlexible(original, a.oldString);
  if (occ === 0) {
    return {
      kind: 'error',
      output: `\`oldString\` not found in ${a.path}.`,
      error: 'no match'
    };
  }
  if (occ > 1 && !a.replaceAll) {
    return {
      kind: 'error',
      output: `\`oldString\` matches ${occ} locations in ${a.path}. Either set \`replaceAll: true\` or expand the context to a unique match.`,
      error: 'ambiguous'
    };
  }

  // Synthesize the post-state. Mirrors the MODIFY branch's splicing.
  let updated: string;
  if (a.replaceAll) {
    let work = original;
    let cursor = 0;
    let safety = occ + 8;
    while (safety-- > 0) {
      const m = findFlexible(work.slice(cursor), a.oldString);
      if (!m) break;
      const absIdx = cursor + m.index;
      work = work.slice(0, absIdx) + a.newString + work.slice(absIdx + m.length);
      cursor = absIdx + a.newString.length;
    }
    updated = work;
  } else {
    const m = findFlexible(original, a.oldString);
    if (!m) {
      return {
        kind: 'error',
        output: 'Match disappeared between count and replace.',
        error: 'race'
      };
    }
    updated = original.slice(0, m.index) + a.newString + original.slice(m.index + m.length);
  }

  const stats = diffStats(original, updated);
  const hunks = computeDiffHunks(original, updated);
  return {
    kind: 'ok',
    preReadOriginal: original,
    payload: {
      kind: 'edit-approval',
      filePath,
      operation: 'modify',
      preBody: original,
      postBody: updated,
      hunks,
      additions: stats.additions,
      deletions: stats.deletions,
      runId,
      ...subagentSlot
    }
  };
}

function failure(id: string, started: number, output: string, error: string): ToolResult {
  return {
    id,
    name: 'edit',
    ok: false,
    output,
    error,
    durationMs: Date.now() - started
  };
}
