import { describe, expect, it } from 'vitest';
import {
  buildMentionFileTreeRows,
  initialMentionFolderExpansion,
  isMentionPickerSelectable
} from '@renderer/components/composer/mention/mentionFileTree';

const SAMPLE_PATHS = [
  'src/',
  'src/main/',
  'src/main/app.ts',
  'src/renderer/',
  'src/renderer/index.tsx',
  'README.md'
];

describe('mentionFileTree', () => {
  it('groups files under expandable folders with depth indentation', () => {
    const expanded = initialMentionFolderExpansion(SAMPLE_PATHS);
    const rows = buildMentionFileTreeRows({
      paths: SAMPLE_PATHS,
      query: '',
      mentionedPaths: [],
      expandedFolders: expanded
    });

    expect(rows.some((r) => r.kind === 'workspace-folder' && r.label === 'src')).toBe(true);
    expect(rows.some((r) => r.kind === 'workspace-file' && r.label === 'src/main/app.ts')).toBe(
      true
    );
    const nestedFile = rows.find((r) => r.label === 'src/main/app.ts');
    expect(nestedFile?.depth).toBeGreaterThan(0);
  });

  it('keeps ancestor folders visible while filtering', () => {
    const rows = buildMentionFileTreeRows({
      paths: SAMPLE_PATHS,
      query: 'app',
      mentionedPaths: [],
      expandedFolders: new Set()
    });

    expect(rows.some((r) => r.kind === 'workspace-folder')).toBe(true);
    expect(rows.some((r) => r.kind === 'workspace-file' && r.label.endsWith('app.ts'))).toBe(true);
  });

  it('marks folders as non-selectable', () => {
    const rows = buildMentionFileTreeRows({
      paths: SAMPLE_PATHS,
      query: '',
      mentionedPaths: [],
      expandedFolders: initialMentionFolderExpansion(SAMPLE_PATHS)
    });
    const folder = rows.find((r) => r.kind === 'workspace-folder');
    expect(folder).toBeTruthy();
    expect(isMentionPickerSelectable(folder!)).toBe(false);
  });
});
