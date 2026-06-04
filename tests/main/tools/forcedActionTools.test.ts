/**
 * Pins the three forced-action loop tools (`delegate` / `finish` /
 * `ask_user`) introduced as first-class callable tools.
 *
 * Each must:
 *   - be registered and resolvable by name,
 *   - carry a well-formed OpenAI function schema (matching name +
 *     required fields),
 *   - ship a non-empty `briefMarkdown` for the harness catalogue,
 *   - be present in `ORCHESTRATOR_TOOLS`,
 *   - and be EXCLUDED from every sub-agent toolset (a worker can never
 *     delegate, finish, or pause the run).
 */

import { describe, expect, it } from 'vitest';
import { getTool, toolSchemasFor } from '@main/tools/registry';
import { ORCHESTRATOR_TOOLS } from '@main/tools/policy/index';
import { validateSubagentToolset } from '@main/tools/policy/index';

const FORCED_ACTION_TOOLS = [
  { name: 'delegate', required: ['id', 'task'] },
  { name: 'finish', required: ['summary'] },
  { name: 'ask_user', required: [] }
] as const;

describe('forced-action loop tools', () => {
  it.each(FORCED_ACTION_TOOLS)('registers a well-formed schema for `$name`', ({ name, required: requiredFields }) => {
    const tool = getTool(name);
    expect(tool, `tool ${name} must be registered`).toBeDefined();
    expect(tool!.name).toBe(name);
    expect(typeof tool!.briefMarkdown).toBe('string');
    expect(tool!.briefMarkdown.length).toBeGreaterThan(0);

    const schema = tool!.schema;
    expect(schema.type).toBe('function');
    expect(schema.function.name).toBe(name);
    expect(typeof schema.function.description).toBe('string');
    expect(schema.function.description.length).toBeGreaterThan(0);

    const params = schema.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(params.type).toBe('object');
    for (const field of requiredFields) {
      expect(params.properties).toHaveProperty(field);
      expect(params.required).toContain(field);
    }
    if (name === 'ask_user') {
      expect(params.properties).toHaveProperty('questions');
      expect(params.properties).toHaveProperty('question');
    }
  });

  it.each(FORCED_ACTION_TOOLS)('includes `$name` in ORCHESTRATOR_TOOLS', ({ name }) => {
    expect(ORCHESTRATOR_TOOLS).toContain(name);
  });

  it('exposes all three via toolSchemasFor(ORCHESTRATOR_TOOLS)', () => {
    const names = toolSchemasFor(ORCHESTRATOR_TOOLS).map((s) => s.function.name);
    expect(names).toContain('delegate');
    expect(names).toContain('finish');
    expect(names).toContain('ask_user');
  });

  it('EXCLUDES delegate / finish / ask_user from any sub-agent toolset', () => {
    // Sub-agents cannot recurse, finish-as-orchestrator, or pause the
    // run. `validateSubagentToolset` drops anything outside
    // SUBAGENT_FULL_TOOLS; requesting only these three falls back to the
    // read-only default and never grants them.
    const granted = validateSubagentToolset(['delegate', 'finish', 'ask_user']);
    expect(granted).not.toContain('delegate');
    expect(granted).not.toContain('finish');
    expect(granted).not.toContain('ask_user');
  });

  it('drops delegate/finish/ask_user even when mixed with a legitimate tool request', () => {
    const granted = validateSubagentToolset(['read', 'delegate', 'edit', 'finish', 'ask_user']);
    expect(granted).toContain('read');
    expect(granted).toContain('edit');
    expect(granted).not.toContain('delegate');
    expect(granted).not.toContain('finish');
    expect(granted).not.toContain('ask_user');
  });

  it('safe-stub `run` handlers never throw (loop intercepts by name)', async () => {
    for (const { name } of FORCED_ACTION_TOOLS) {
      const tool = getTool(name)!;
      const result = await tool.run(
        { id: 'x', task: 't', summary: 's', question: 'q' },
        {} as never
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBe('orchestrator_intercept_only');
      expect(result.name).toBe(name);
    }
  });
});
