import { describe, expect, it } from 'vitest';
import { formatToolGroupDisplayPrimary } from '@renderer/components/timeline/shared/formatToolGroupDisplayPrimary.js';

describe('formatToolGroupDisplayPrimary', () => {
  it('basenames long file paths for read/edit rows', () => {
    const out = formatToolGroupDisplayPrimary('read', 'src/main/tools/foo.py');
    expect(out.display).toBe('foo.py');
    expect(out.title).toBe('src/main/tools/foo.py');
  });

  it('keeps workspace shorthand', () => {
    expect(formatToolGroupDisplayPrimary('ls', 'workspace').display).toBe('workspace');
  });

  it('truncates multi-line bash to the first line', () => {
    const cmd = 'python -c "print(1)"\necho second';
    const out = formatToolGroupDisplayPrimary('bash', cmd);
    expect(out.display).toBe('python -c "print(1)"');
    expect(out.title).toBe(cmd);
  });
});
