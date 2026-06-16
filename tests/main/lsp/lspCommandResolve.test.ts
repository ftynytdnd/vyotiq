/**
 * LSP command resolution — PATH enrichment.
 */

import { describe, expect, it } from 'vitest';
import { enrichLspPathEnv } from '../../../src/main/lsp/lspCommandResolve.js';

describe('enrichLspPathEnv', () => {
  it('prepends npm global bin to PATH on Windows', () => {
    const env = enrichLspPathEnv({
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
      PATH: 'C:\\Windows\\System32'
    });
    expect(env.PATH).toContain('C:\\Users\\test\\AppData\\Roaming\\npm');
    expect(env.PATH).toContain('C:\\Windows\\System32');
  });
});
