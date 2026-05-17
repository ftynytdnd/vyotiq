/**
 * Coverage for the new Briefing Scope list.
 *
 * Replaces the legacy SubAgentHeader chip-overflow tests: the new
 * surface is a structured list (no overflow toggle, no chips), so
 * the assertions are reframed to match the post-redesign contract:
 *   - Every granted tool renders with its one-line description
 *     sourced from `TOOL_ONE_LINERS`.
 *   - Every inlined file renders, paired with an `inlined` rationale.
 *   - Every missing file renders with the `not found` rationale and
 *     the strikethrough/danger styling cue (text content only — the
 *     CSS classes are pinned by separate render tests if needed).
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SubAgentScopeList } from '@renderer/components/timeline/subagent/briefing/SubAgentScopeList';
import { TOOL_ONE_LINERS } from '@shared/types/toolDescriptions';

describe('SubAgentScopeList', () => {
  it('renders ALL granted tools (no chip cap, no overflow toggle)', () => {
    const tools = ['read', 'edit', 'bash', 'search', 'memory', 'recall'];
    const { container } = render(
      <SubAgentScopeList tools={tools} okFiles={[]} missingFiles={[]} />
    );
    for (const t of tools) {
      expect(container.textContent).toContain(t);
    }
    // No `+N more` overflow control survived the redesign.
    expect(container.textContent).not.toMatch(/\+\d+ more/);
  });

  it('pairs each tool with its TOOL_ONE_LINERS description', () => {
    const tools = ['read', 'edit'];
    const { container } = render(
      <SubAgentScopeList tools={tools} okFiles={[]} missingFiles={[]} />
    );
    expect(container.textContent).toContain(TOOL_ONE_LINERS.read);
    expect(container.textContent).toContain(TOOL_ONE_LINERS.edit);
  });

  it('renders ALL inlined files with the `inlined` rationale', () => {
    const okFiles = Array.from({ length: 12 }, (_, i) => `src/file-${i + 1}.ts`);
    const { container } = render(
      <SubAgentScopeList tools={[]} okFiles={okFiles} missingFiles={[]} />
    );
    for (const f of okFiles) {
      expect(container.textContent).toContain(f);
    }
    // The rationale label appears at least once and matches the
    // `inlined` design-token from the implementation.
    expect(container.textContent).toMatch(/inlined/);
  });

  it('renders missing files with a `not found` rationale', () => {
    const missingFiles = ['core/agent.py', 'docs/missing.md'];
    const { container } = render(
      <SubAgentScopeList
        tools={[]}
        okFiles={[]}
        missingFiles={missingFiles}
      />
    );
    for (const m of missingFiles) {
      expect(container.textContent).toContain(m);
    }
    expect(container.textContent).toMatch(/not found/i);
  });

  it('renders nothing when both lists are empty', () => {
    const { container } = render(
      <SubAgentScopeList tools={[]} okFiles={[]} missingFiles={[]} />
    );
    // Empty trees on both axes → no Scope subsection at all.
    expect(container.textContent).toBe('');
  });
});
