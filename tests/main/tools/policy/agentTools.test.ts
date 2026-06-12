import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from '../../../../src/main/tools/policy/agentTools.js';
import { listTools } from '../../../../src/main/tools/registry.js';
import { REGISTERED_TOOL_NAMES } from '../../../../src/shared/types/tool.js';
import { normalizeRegisteredToolName } from '../../../../src/shared/tools/normalizeToolName.js';

describe('AGENT_TOOLS', () => {
  it('matches every registered tool except unknown', () => {
    const names = new Set(listTools().map((t) => t.name));
    for (const n of AGENT_TOOLS) {
      expect(names.has(n)).toBe(true);
    }
    expect(AGENT_TOOLS).not.toContain('delegate' as never);
    expect(AGENT_TOOLS).toContain('report');
  });
});

describe('tool-name single source consistency', () => {
  it('registry keys equal the canonical REGISTERED_TOOL_NAMES set', () => {
    const registry = new Set(listTools().map((t) => t.name));
    const canonical = new Set<string>(REGISTERED_TOOL_NAMES);
    expect(registry).toEqual(canonical);
  });

  it('every AGENT_TOOLS entry is a canonical registered name', () => {
    const canonical = new Set<string>(REGISTERED_TOOL_NAMES);
    for (const n of AGENT_TOOLS) {
      expect(canonical.has(n)).toBe(true);
    }
  });

  it('the normalizer recognizes every canonical name (incl. report)', () => {
    for (const n of REGISTERED_TOOL_NAMES) {
      expect(normalizeRegisteredToolName(n)).toBe(n);
      // Common provider namespace prefix must also normalize.
      expect(normalizeRegisteredToolName(`functions.${n}`)).toBe(n);
    }
    // Regression guard for the historical drift where `report` was
    // missing from the normalizer set.
    expect(normalizeRegisteredToolName('report')).toBe('report');
  });
});
