import { describe, expect, it } from 'vitest';
import { parseNvidiaContextLength } from '@shared/providers/nvidiaNgcContextParse.js';

describe('parseNvidiaContextLength', () => {
  it('parses ISL label from Gemma 4 model card', () => {
    const text = '**Input Context Length (ISL):** 256K';
    expect(parseNvidiaContextLength(text)).toBe(262_144);
  });

  it('parses million-word context phrasing', () => {
    expect(parseNvidiaContextLength('Maximum context length of 1 million tokens')).toBe(1_000_000);
  });

  it('parses 128k table-style values', () => {
    expect(parseNvidiaContextLength('Context Length: 128K tokens')).toBe(131_072);
  });

  it('rejects implausible values', () => {
    expect(parseNvidiaContextLength('context length: 20 seconds')).toBeUndefined();
  });
});
