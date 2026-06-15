import { describe, expect, it } from 'vitest';
import { tryRepairTruncatedToolArgsRecord } from '@main/orchestrator/loop/repairToolArgsJson.js';
import { parseToolArgs } from '@main/orchestrator/loop/parseToolArgs.js';

describe('repairToolArgsJson', () => {
  it('repairs an unterminated query string observed in production logs', () => {
    const repaired = tryRepairTruncatedToolArgsRecord('{"query": "FIXME');
    expect(repaired).toEqual({ query: 'FIXME' });
  });

  it('parseToolArgs applies repair before failing', () => {
    const { args, parseError, repaired } = parseToolArgs('search', '{"query": "FIXME');
    expect(parseError).toBeUndefined();
    expect(repaired).toBe(true);
    expect(args).toEqual({ query: 'FIXME' });
  });

  it('does not repair non-object buffers', () => {
    expect(tryRepairTruncatedToolArgsRecord('not-json')).toBeNull();
  });
});
