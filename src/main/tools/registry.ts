/**
 * Tool registry. Single source of truth for the tool catalogue.
 */

import type { Tool } from './types.js';
import type { RegisteredToolName } from '@shared/types/tool.js';
import { bashTool } from './bash.tool.js';
import { lsTool } from './ls.tool.js';
import { readTool } from './read.tool.js';
import { editTool } from './edit.tool.js';
import { deleteTool } from './delete.tool.js';
import { searchTool } from './search.tool.js';
import { sgTool } from './sg.tool.js';
import { memoryTool } from './memory.tool.js';
import { recallTool } from './recall.tool.js';
import { contextTool } from './context.tool.js';
import { todosTool } from './todos.tool.js';
import { finishTool } from './finish.tool.js';
import { askUserTool } from './ask_user.tool.js';
import { reportTool } from './report.tool.js';
import { captureTool } from './capture.tool.js';
import { heartbeatTool } from './heartbeat.tool.js';
import { continueTool } from './continue.tool.js';
// Internal registry. Kept module-private so the only legitimate access
// paths are `listTools` / `getTool` / `isKnownToolName` / `toolSchemasFor`,
// each of which already encodes the policy guarantees we want.
const TOOLS: Record<RegisteredToolName, Tool> = {
  bash: bashTool,
  ls: lsTool,
  read: readTool,
  edit: editTool,
  delete: deleteTool,
  search: searchTool,
  sg: sgTool,
  memory: memoryTool,
  recall: recallTool,
  context: contextTool,
  todos: todosTool,
  report: reportTool,
  capture: captureTool,
  heartbeat: heartbeatTool,
  continue: continueTool,
  finish: finishTool,
  ask_user: askUserTool
};

/**
 * Type-narrowing predicate. Use at the orchestrator boundary to refine
 * an arbitrary string into the registered-tool union before dispatching.
 * Pairs with `getTool(name)` returning `undefined` for unknown names.
 */
export function isKnownToolName(name: string): name is RegisteredToolName {
  return Object.prototype.hasOwnProperty.call(TOOLS, name);
}

export function listTools(): Tool[] {
  return Object.values(TOOLS);
}

export function getTool(name: string): Tool | undefined {
  return (TOOLS as Record<string, Tool>)[name];
}

/**
 * Tools that are never batched by the dependency scheduler: `finish` and
 * `ask_user` are intercepted by the run loop and terminate/​pause the run,
 * so a `depends_on` edge on them is meaningless. Every other tool may
 * declare dependencies on sibling calls in the same assistant turn.
 */
const DEPENDS_ON_EXCLUDED = new Set<string>(['finish', 'ask_user']);

/**
 * Shared `depends_on` wire-schema property. Injected centrally (rather
 * than duplicated across every tool file) so the model can discover the
 * dependency-batching contract that `toolDependencyBatches.ts` already
 * consumes. Independent calls omit it and run in parallel.
 */
const DEPENDS_ON_PROPERTY = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Optional. IDs of other tool calls in THIS SAME assistant turn that must ' +
    "finish before this call runs. Set it only when this call needs another " +
    "call's output; omit it for independent calls so they execute in parallel."
} as const;

function withDependsOn(schema: Tool['schema']): Tool['schema'] {
  const params = schema.function.parameters as Record<string, unknown>;
  const properties = {
    ...((params.properties as Record<string, unknown> | undefined) ?? {}),
    depends_on: DEPENDS_ON_PROPERTY
  };
  return {
    type: 'function',
    function: {
      ...schema.function,
      parameters: { ...params, properties }
    }
  };
}

/** Schemas for a specific subset of tools, by name. Names not in the registry
 *  are silently dropped. This function is the PHYSICAL enforcement chokepoint
 *  for the agent tool-policy split: tools not in `AGENT_TOOLS` are never
 *  exposed on the wire. Policy lives in `tools/policy/agentTools.ts`.
 *
 *  Action tools get an injected optional `depends_on` parameter so the
 *  model can declare cross-call ordering (see `toolDependencyBatches.ts`). */
export function toolSchemasFor(names: readonly string[], opts?: { contextSkillNames?: string[] }) {
  const allowed = new Set(names);
  return listTools()
    .filter((t) => allowed.has(t.name))
    .map((t) => {
      const schema =
        t.name === 'context' && opts?.contextSkillNames?.length
          ? patchContextToolSchema(t.schema, opts.contextSkillNames)
          : t.schema;
      return DEPENDS_ON_EXCLUDED.has(t.name) ? schema : withDependsOn(schema);
    });
}

function patchContextToolSchema(
  schema: Tool['schema'],
  skillNames: string[]
): Tool['schema'] {
  const params = schema.function.parameters as Record<string, unknown>;
  const properties = {
    ...((params.properties as Record<string, unknown> | undefined) ?? {}),
    skill: {
      type: 'string',
      enum: skillNames,
      description:
        'For action="load": skill name from the in-prompt catalogue or action="list".'
    },
    pack: {
      type: 'string',
      enum: skillNames,
      description: 'Deprecated alias for skill (legacy context-pack ids).'
    }
  };
  return {
    type: 'function',
    function: {
      ...schema.function,
      parameters: { ...params, properties }
    }
  };
}
