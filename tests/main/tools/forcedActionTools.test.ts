import { describe, expect, it } from 'vitest';
import { getTool, toolSchemasFor } from '@main/tools/registry';
import { AGENT_TOOLS } from '@main/tools/policy/agentTools';

const TERMINAL_TOOLS = [
  { name: 'finish', required: ['summary'] },
  { name: 'ask_user', required: [] }
] as const;

describe('terminal loop tools', () => {
  it.each(TERMINAL_TOOLS)('registers a well-formed schema for `$name`', ({ name, required: requiredFields }) => {
    const tool = getTool(name);
    expect(tool).toBeDefined();
    expect(tool!.name).toBe(name);
    expect(tool!.briefMarkdown.length).toBeGreaterThan(0);
    const params = tool!.schema.function.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(params.type).toBe('object');
    for (const field of requiredFields) {
      expect(params.properties).toHaveProperty(field);
      expect(params.required).toContain(field);
    }
  });

  it('includes finish and ask_user in AGENT_TOOLS', () => {
    expect(AGENT_TOOLS).toContain('finish');
    expect(AGENT_TOOLS).toContain('ask_user');
  });

  it('does not register delegate', () => {
    expect(getTool('delegate')).toBeUndefined();
  });

  it('exposes finish/ask_user via toolSchemasFor(AGENT_TOOLS)', () => {
    const names = toolSchemasFor(AGENT_TOOLS).map((s) => s.function.name);
    expect(names).toContain('finish');
    expect(names).toContain('ask_user');
    expect(names).not.toContain('delegate');
  });
});
