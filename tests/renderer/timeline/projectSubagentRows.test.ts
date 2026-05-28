/**
 * projectSubagentRows — collapse consecutive sub-agent lines into groups.
 */

import { describe, expect, it } from 'vitest';
import { projectSubagentRows } from '@renderer/components/timeline/shared/projectSubagentRows';
import type { Row } from '@renderer/components/timeline/reducer/deriveRows';

function subLine(id: string): Row {
  return { kind: 'subagent-line', key: `sub:${id}`, subagentId: id };
}

function userPrompt(): Row {
  return { kind: 'user-prompt', key: 'p1', id: 'p1', content: 'go' };
}

describe('projectSubagentRows', () => {
  it('passes through non-subagent rows unchanged', () => {
    const rows: Row[] = [userPrompt(), { kind: 'assistant-text', key: 'a1', id: 'a1' }];
    expect(projectSubagentRows(rows)).toEqual(rows);
  });

  it('collapses a lone sub-agent line into a subagent-group', () => {
    const rows: Row[] = [userPrompt(), subLine('A1')];
    expect(projectSubagentRows(rows)).toEqual([
      userPrompt(),
      { kind: 'subagent-group', key: 'subagent-group:A1', subagentIds: ['A1'] }
    ]);
  });

  it('collapses two or more consecutive sub-agent lines into one group', () => {
    const rows: Row[] = [userPrompt(), subLine('A1'), subLine('A2'), subLine('A3')];
    const out = projectSubagentRows(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(userPrompt());
    expect(out[1]).toEqual({
      kind: 'subagent-group',
      key: 'subagent-group:A1:A2:A3',
      subagentIds: ['A1', 'A2', 'A3']
    });
  });

  it('preserves assistant-text rows in place between batches', () => {
    const rows: Row[] = [
      userPrompt(),
      { kind: 'assistant-text', key: 'a1', id: 'msg-turn' },
      subLine('A1'),
      subLine('A2')
    ];
    const out = projectSubagentRows(rows);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual(userPrompt());
    expect(out[1]).toEqual({
      kind: 'assistant-text',
      key: 'a1',
      id: 'msg-turn'
    });
    expect(out[2]).toEqual({
      kind: 'subagent-group',
      key: 'subagent-group:A1:A2',
      subagentIds: ['A1', 'A2']
    });
  });

  it('splits groups when another row interrupts the sub-agent run', () => {
    const rows: Row[] = [
      subLine('A1'),
      subLine('A2'),
      { kind: 'tool-group', key: 'tg:1', toolName: 'read', children: [] },
      subLine('B1'),
      subLine('B2')
    ];
    const out = projectSubagentRows(rows);
    expect(out).toEqual([
      { kind: 'subagent-group', key: 'subagent-group:A1:A2', subagentIds: ['A1', 'A2'] },
      { kind: 'tool-group', key: 'tg:1', toolName: 'read', children: [] },
      { kind: 'subagent-group', key: 'subagent-group:B1:B2', subagentIds: ['B1', 'B2'] }
    ]);
  });

  it('emits separate groups when assistant-text is interleaved between delegate waves', () => {
    const rows: Row[] = [
      userPrompt(),
      { kind: 'assistant-text', key: 'a1', id: 'msg-turn' },
      subLine('B1'),
      subLine('B2'),
      { kind: 'assistant-text', key: 'a2', id: 'msg-turn-2' },
      subLine('C1'),
      subLine('C2')
    ];
    const out = projectSubagentRows(rows);
    const groups = out.filter((r) => r.kind === 'subagent-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ subagentIds: ['B1', 'B2'] });
    expect(groups[1]).toMatchObject({ subagentIds: ['C1', 'C2'] });
  });
});
