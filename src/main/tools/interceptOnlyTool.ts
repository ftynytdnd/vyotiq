/**
 * Registry stub for tools the run loop intercepts by name (`ask_user`,
 * `finish`). Real execution never reaches `run()`.
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolName, ToolResult } from '@shared/types/tool.js';

export function makeInterceptOnlyTool(
  name: ToolName,
  briefMarkdown: string,
  schema: Tool['schema']
): Tool {
  return {
    name,
    briefMarkdown,
    schema,
    async run(): Promise<ToolResult> {
      const id = randomUUID();
      return {
        id,
        name,
        ok: false,
        output:
          `The orchestrator run loop intercepts \`${name}\` by name; this handler must not run.`,
        error: 'orchestrator_intercept_only',
        durationMs: 0
      };
    }
  };
}
