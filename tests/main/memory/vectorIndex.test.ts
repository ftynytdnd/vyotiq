import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { indexWorkspaceVectors } from '@main/memory/vector/indexWorkspace';
import { chunkCount, closeVectorDb, openVectorDb } from '@main/memory/vector/vectorDb';
import { searchVectorIndex } from '@main/memory/vector/vectorSearch';
import { WORKSPACE_DOTDIR, MEMORY_SUBDIR } from '@shared/constants';

let workspacePath: string | null = null;

afterEach(async () => {
  if (workspacePath) {
    closeVectorDb(workspacePath);
    await rm(workspacePath, { recursive: true, force: true });
    workspacePath = null;
  }
});

describe('vector index', () => {
  it('indexes notes and returns vector hits for related queries', async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'vyotiq-vec-'));
    const memDir = join(workspacePath, WORKSPACE_DOTDIR, MEMORY_SUBDIR);
    await mkdir(memDir, { recursive: true });
    await mkdir(join(workspacePath, 'src'), { recursive: true });
    await writeFile(
      join(memDir, 'architecture.md'),
      '# Architecture\nVyotiq uses sqlite-vec for hybrid memory retrieval.\n',
      'utf8'
    );
    await writeFile(
      join(workspacePath, 'src', 'feature.ts'),
      'export function hybridRetrieval() { return "sqlite-vec"; }\n',
      'utf8'
    );

    const stats = await indexWorkspaceVectors(workspacePath);
    expect(stats.chunksWritten).toBeGreaterThan(0);

    const db = await openVectorDb(workspacePath);
    expect(chunkCount(db)).toBeGreaterThan(0);

    const hits = await searchVectorIndex(workspacePath, 'sqlite vector hybrid memory');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.sourceKind === 'note' || h.sourceKind === 'code')).toBe(true);
  });
});
