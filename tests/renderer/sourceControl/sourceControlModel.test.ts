import { describe, expect, it } from 'vitest';
import {
  buildSourceControlRows,
  buildSourceControlTree,
  flattenSourceControlTree
} from '@renderer/components/sourceControl/sourceControlModel';
import { collectChangedFolderPaths } from '@renderer/components/sourceControl/SourceControlFileList';

describe('sourceControlModel', () => {
  it('buildSourceControlRows sorts staged and unstaged paths', () => {
    const { stagedRows, unstagedRows } = buildSourceControlRows(
      { 'b.ts': 'M', 'a.ts': 'A' },
      { 'z.ts': 'M', 'm.ts': '?' }
    );
    expect(stagedRows.map((r) => r.path)).toEqual(['a.ts', 'b.ts']);
    expect(unstagedRows.map((r) => r.path)).toEqual(['m.ts', 'z.ts']);
    expect(stagedRows[0]?.section).toBe('staged');
    expect(unstagedRows[0]?.section).toBe('unstaged');
  });

  it('buildSourceControlTree nests paths and sorts folders before files', () => {
    const { unstagedRows } = buildSourceControlRows({}, { 'src/a.ts': 'M', 'README.md': 'M' });
    const tree = buildSourceControlTree(unstagedRows);
    expect(tree.map((n) => n.name)).toEqual(['src', 'README.md']);
    expect(tree[0]?.children?.[0]?.file?.path).toBe('src/a.ts');
  });

  it('flattenSourceControlTree respects expanded folders', () => {
    const { unstagedRows } = buildSourceControlRows(
      {},
      { 'src/a.ts': 'M', 'src/b.ts': 'M', 'root.ts': 'M' }
    );
    const tree = buildSourceControlTree(unstagedRows);
    expect(tree.find((n) => n.name === 'src')?.path).toBe('src');
    const flat = flattenSourceControlTree(tree, 0, new Set(['src']));
    expect(flat.map((f) => f.node.path)).toEqual(['src', 'src/a.ts', 'src/b.ts', 'root.ts']);
  });

  it('buildSourceControlTree uses full paths for nested folders', () => {
    const { unstagedRows } = buildSourceControlRows(
      {},
      { '.vyotiq/captures/a.png': '?', 'ai-agent-landing/src/index.ts': 'M' }
    );
    const tree = buildSourceControlTree(unstagedRows);
    const vyotiq = tree.find((n) => n.name === '.vyotiq');
    expect(vyotiq?.path).toBe('.vyotiq');
    expect(vyotiq?.children?.find((n) => n.name === 'captures')?.path).toBe('.vyotiq/captures');
    const landing = tree.find((n) => n.name === 'ai-agent-landing');
    expect(landing?.children?.find((n) => n.name === 'src')?.path).toBe('ai-agent-landing/src');
  });

  it('collectChangedFolderPaths gathers every parent directory', () => {
    const { unstagedRows } = buildSourceControlRows(
      {},
      { '.vyotiq/captures/a.png': '?', 'src/lib/a.ts': 'M' }
    );
    expect([...collectChangedFolderPaths(unstagedRows)].sort()).toEqual(
      ['.vyotiq', '.vyotiq/captures', 'src', 'src/lib'].sort()
    );
  });

  it('collectChangedFolderPaths collapses to top-level when many files', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      path: `pkg-${i}/file.ts`,
      status: 'M' as const,
      section: 'unstaged' as const
    }));
    expect([...collectChangedFolderPaths(rows, { collapseDeep: true })].sort()).toEqual(
      Array.from({ length: 30 }, (_, i) => `pkg-${i}`).sort()
    );
  });
});
