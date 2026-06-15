import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { redactUserHomeInPath, redactUserHomeInText } from '@shared/path/redactUserHomeInPath.js';

describe('redactUserHomeInPath', () => {
  it('replaces the runtime user profile prefix', () => {
    const home = os.homedir();
    const abs = `${home}${process.platform === 'win32' ? '\\' : '/'}Documents\\vyotiq`;
    const out = redactUserHomeInPath(abs);
    if (process.platform === 'win32') {
      expect(out).toBe('%USERPROFILE%\\Documents\\vyotiq');
    } else {
      expect(out).toBe('~/Documents\\vyotiq');
    }
  });

  it('leaves paths outside the home directory unchanged', () => {
    expect(redactUserHomeInPath('/var/log')).toBe('/var/log');
  });

  it('redacts repeated home segments inside multiline text', () => {
    const home = os.homedir();
    const p =
      process.platform === 'win32' ? `${home}\\a.ts` : `${home}/a.ts`;
    const out = redactUserHomeInText(`first ${p}\nsecond ${p}`);
    expect(out).not.toContain(home);
    expect(out.match(/%USERPROFILE%|~/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
