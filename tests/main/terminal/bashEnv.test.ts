import { describe, expect, it } from 'vitest';
import { buildBashEnv } from '@main/terminal/bashEnv.js';

describe('buildBashEnv', () => {
  it('drops secret-shaped vars even when allowlisted names match', () => {
    const prev = process.env.LANG;
    process.env.LANG = 'en_US.UTF-8';
    process.env.LANG_API_TOKEN = 'secret';
    try {
      const env = buildBashEnv();
      expect(env.LANG).toBe('en_US.UTF-8');
      expect(env.LANG_API_TOKEN).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.LANG;
      else process.env.LANG = prev;
      delete process.env.LANG_API_TOKEN;
    }
  });
});
