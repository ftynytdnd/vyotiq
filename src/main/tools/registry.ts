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
import { memoryTool } from './memory.tool.js';
import { recallTool } from './recall.tool.js';
import { reportTool } from './report.tool.js';
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
  memory: memoryTool,
  recall: recallTool,
  report: reportTool
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

/** Schemas for a specific subset of tools, by name. Names not in the registry
 *  are silently dropped. This function is the PHYSICAL enforcement chokepoint
 *  for the orchestrator-vs-sub-agent tool-policy split: the forbidden tool is
 *  never even exposed to the wire, regardless of what the harness markdown
 *  says. Policies live in `tools/policy/` (orchestrator / sub-agent default
 *  / sub-agent full). */
export function toolSchemasFor(names: readonly string[]) {
  const allowed = new Set(names);
  return listTools()
    .filter((t) => allowed.has(t.name))
    .map((t) => t.schema);
}
