/**
 * `memory` tool — read/write/append the markdown memory store. Routes to
 * global meta-rules or workspace notes based on the `scope` parameter.
 */

import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext } from './types.js';
import type { ToolData, ToolResult } from '@shared/types/tool.js';
import {
  appendGlobalMetaRule,
  readGlobalMetaRules,
  writeGlobalMetaRules
} from '../memory/globalMeta.js';
import {
  appendWorkspaceNote,
  listWorkspaceNotes,
  readWorkspaceNote,
  writeWorkspaceNote
} from '../memory/workspaceNotes.js';
import {
  isPerConversationRunProgressKey,
  resolveRunProgressKey,
  RUN_PROGRESS_AGENT_KEY
} from '../memory/runProgressNote.js';
import {
  touchGlobalMemoryLastReference,
  touchMemoryLastReference
} from '../memory/lastReferenced.js';
import { scheduleWorkspaceVectorIndex } from '../memory/vector/indexScheduler.js';

interface MemoryArgs {
  action: 'list' | 'read' | 'write' | 'append';
  scope: 'global' | 'workspace';
  key?: string;
  content?: string;
}

export const memoryTool: Tool = {
  name: 'memory',
  briefMarkdown: `### Tool: \`memory\`

**WHAT it is.** A persistent markdown notebook. Two scopes:
- \`global\`: cross-session meta-rules (e.g. user preferences). One file.
- \`workspace\`: project-specific notes (e.g. project structure, recurring bugs). Many files keyed by topic.

**HOW to use it.** Four actions: \`list\`, \`read\`, \`write\`, \`append\`.

\`\`\`json
{ "name": "memory", "arguments": { "action": "list", "scope": "workspace" } }
{ "name": "memory", "arguments": { "action": "read",  "scope": "workspace", "key": "project-structure" } }
{ "name": "memory", "arguments": { "action": "write", "scope": "workspace", "key": "user-preferences", "content": "..." } }
{ "name": "memory", "arguments": { "action": "append","scope": "global",   "content": "User prefers Vanilla CSS over Tailwind." } }
\`\`\`

**WHY it exists.** To accumulate durable, lightweight context that survives across runs. The harness mandates writing notes when the user expresses a persistent preference or when project structure is freshly understood.

**WHEN to trigger it.**
- Read at the start of a task to recall past decisions.
- Write when a recurring pattern, preference, or bug is identified.
- Append (\`global\`) immediately when the user issues a meta-correction.`,
  schema: {
    type: 'function',
    function: {
      name: 'memory',
      description: 'Read/write/append persistent markdown notes (global meta-rules or workspace notes).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'write', 'append'] },
          scope: { type: 'string', enum: ['global', 'workspace'] },
          key: { type: 'string', description: 'Note key (workspace scope only).' },
          content: { type: 'string' }
        },
        required: ['action', 'scope']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<MemoryArgs>;
    if (!a.action || !a.scope) return fail(id, started, 'Error: `action` and `scope` are required.', 'invalid args');

    try {
      if (a.scope === 'global') {
        return await runGlobal(a, id, started, ctx);
      }
      // Pass the run's pinned `workspacePath` so workspace memory
      // operations always target the run's `<workspace>/.vyotiq/memory/`,
      // regardless of any concurrent change to the globally-active
      // workspace. Without this, a memory write from a run in
      // workspace A could land in workspace B's `.vyotiq/memory/`
      // simply because the user switched B to active mid-run.
      return await runWorkspace(a, id, started, ctx.workspacePath, ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Memory error: ${msg}`, msg);
    }
  }
};

async function runGlobal(
  a: Partial<MemoryArgs>,
  id: string,
  started: number,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (a.action) {
    case 'read':
    case 'list': {
      const content = await readGlobalMetaRules();
      void touchGlobalMemoryLastReference(ctx.conversationId).catch(() => undefined);
      return ok(id, started, `# Global Meta-Rules\n${content}`, {
        tool: 'memory',
        action: 'read',
        scope: 'global',
        preview: content
      });
    }
    case 'write': {
      if (typeof a.content !== 'string') return fail(id, started, 'Error: `content` required.', 'missing content');
      await writeGlobalMetaRules(a.content);
      void touchGlobalMemoryLastReference(ctx.conversationId).catch(() => undefined);
      return ok(id, started, 'Global meta-rules overwritten.', {
        tool: 'memory',
        action: 'write',
        scope: 'global',
        preview: a.content
      });
    }
    case 'append': {
      if (typeof a.content !== 'string') return fail(id, started, 'Error: `content` required.', 'missing content');
      await appendGlobalMetaRule(a.content);
      void touchGlobalMemoryLastReference(ctx.conversationId).catch(() => undefined);
      return ok(id, started, 'Appended to global meta-rules.', {
        tool: 'memory',
        action: 'append',
        scope: 'global',
        preview: a.content
      });
    }
    default:
      return fail(id, started, `Unknown action: ${String(a.action)}`, 'unknown action');
  }
}

async function runWorkspace(
  a: Partial<MemoryArgs>,
  id: string,
  started: number,
  workspacePath: string,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (a.action) {
    case 'list': {
      const notes = await listWorkspaceNotes(workspacePath);
      const visible = notes.filter((n) => !isPerConversationRunProgressKey(n.key));
      const lines = visible.map((n) => `- ${n.key} (${new Date(n.updatedAt).toISOString()})`);
      const body = visible.length
        ? `# Workspace Notes\n${lines.join('\n')}\n\n(Per-conversation \`${RUN_PROGRESS_AGENT_KEY}\` notes are managed automatically — use key \`${RUN_PROGRESS_AGENT_KEY}\` to read/write yours.)`
        : '# No workspace notes yet.';
      return ok(id, started, body, {
        tool: 'memory',
        action: 'list',
        scope: 'workspace',
        count: visible.length,
        preview: body
      });
    }
    case 'read': {
      if (!a.key) return fail(id, started, 'Error: `key` required.', 'missing key');
      const storageKey = resolveRunProgressKey(a.key, ctx.conversationId);
      const note = await readWorkspaceNote(storageKey, workspacePath);
      if (!note) {
        return ok(id, started, `# Note "${a.key}" does not exist.`, {
          tool: 'memory',
          action: 'read',
          scope: 'workspace',
          key: a.key
        });
      }
      void touchMemoryLastReference(ctx.workspaceId, a.key, ctx.conversationId).catch(
        () => undefined
      );
      return ok(id, started, `# ${note.key === storageKey && a.key === RUN_PROGRESS_AGENT_KEY ? RUN_PROGRESS_AGENT_KEY : note.key}\n${note.content}`, {
        tool: 'memory',
        action: 'read',
        scope: 'workspace',
        key: a.key,
        preview: note.content
      });
    }
    case 'write': {
      if (!a.key) return fail(id, started, 'Error: `key` required.', 'missing key');
      if (typeof a.content !== 'string') return fail(id, started, 'Error: `content` required.', 'missing content');
      const storageKey = resolveRunProgressKey(a.key, ctx.conversationId);
      await writeWorkspaceNote(storageKey, a.content, workspacePath);
      scheduleWorkspaceVectorIndex(workspacePath);
      void touchMemoryLastReference(ctx.workspaceId, a.key, ctx.conversationId).catch(
        () => undefined
      );
      return ok(id, started, `Wrote note: ${a.key}`, {
        tool: 'memory',
        action: 'write',
        scope: 'workspace',
        key: a.key,
        preview: a.content
      });
    }
    case 'append': {
      if (!a.key) return fail(id, started, 'Error: `key` required.', 'missing key');
      if (typeof a.content !== 'string') return fail(id, started, 'Error: `content` required.', 'missing content');
      const storageKey = resolveRunProgressKey(a.key, ctx.conversationId);
      await appendWorkspaceNote(storageKey, a.content, workspacePath);
      scheduleWorkspaceVectorIndex(workspacePath);
      void touchMemoryLastReference(ctx.workspaceId, a.key, ctx.conversationId).catch(
        () => undefined
      );
      return ok(id, started, `Appended to note: ${a.key}`, {
        tool: 'memory',
        action: 'append',
        scope: 'workspace',
        key: a.key,
        preview: a.content
      });
    }
    default:
      return fail(id, started, `Unknown action: ${String(a.action)}`, 'unknown action');
  }
}

function ok(id: string, started: number, output: string, data: ToolData): ToolResult {
  return { id, name: 'memory', ok: true, output, data, durationMs: Date.now() - started };
}
function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'memory', ok: false, output, error, durationMs: Date.now() - started };
}
