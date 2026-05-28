import { describe, expect, it } from 'vitest';
import {
  IDLE_SUMMARY_RUN_ID_PREFIX,
  isIdleSummaryRunId,
  mintIdleSummaryRunId
} from '@shared/contextSummary/idleSummaryRunId.js';

describe('idleSummaryRunId', () => {
  it('isIdleSummaryRunId recognizes minted ids', () => {
    const id = mintIdleSummaryRunId();
    expect(id.startsWith(IDLE_SUMMARY_RUN_ID_PREFIX)).toBe(true);
    expect(isIdleSummaryRunId(id)).toBe(true);
    expect(isIdleSummaryRunId('run-orchestrator-1')).toBe(false);
  });
});
