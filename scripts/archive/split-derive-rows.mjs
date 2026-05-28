import fs from 'fs';

const lines = fs.readFileSync(
  'src/renderer/components/timeline/reducer/deriveRows.ts',
  'utf8'
).split('\n');

const partialsStart = lines.findIndex((l) => l.startsWith('function appendSynthesizedPartialRows'));
const toolSummaryStart = lines.findIndex((l) => l.startsWith('export function toolGroupSummary'));
const dir = 'src/renderer/components/timeline/reducer/deriveRows';

fs.mkdirSync(dir, { recursive: true });

const partialsHeader = [
  "import type { ToolName } from '@shared/types/tool.js';",
  "import type { PartialToolCallArgs } from '../types.js';",
  "import { shouldSynthesizePartialToolEntry } from '../partialToolVisibility.js';",
  "import type { Row, ToolGroupChild } from '../deriveRows.js';",
  '',
  "const KNOWN_TOOL_NAMES: readonly ToolName[] = [",
  "  'bash', 'ls', 'read', 'edit', 'delete', 'search', 'memory', 'recall', 'report', 'unknown'",
  '];',
  ''
].join('\n');

let partialsBody = lines.slice(partialsStart, toolSummaryStart).join('\n');
partialsBody = partialsBody.replace(
  'function appendSynthesizedPartialRows',
  'export function appendSynthesizedPartialRows'
);
partialsBody = partialsBody.replace('function pickToolName', 'export function pickToolName');

fs.writeFileSync(`${dir}/partials.ts`, partialsHeader + partialsBody);

const groupHeader = [
  "import type { ToolName } from '@shared/types/tool.js';",
  "import { computeDiffOps } from '@shared/text/diff/computeDiffHunks.js';",
  "import type { ToolGroupChild } from '../deriveRows.js';",
  ''
].join('\n');

const groupBody = lines.slice(toolSummaryStart).join('\n');
fs.writeFileSync(`${dir}/groupTools.ts`, groupHeader + groupBody);

const runHeader = [
  "import type { TokenUsageAggregate } from '../types.js';",
  '',
  'export type OpenRun = { promptId: string; promptTs: number; lastTs: number };',
  'export type OpenRunUsage = {',
  '  orchestrator?: TokenUsageAggregate;',
  '  subagents: Record<string, TokenUsageAggregate>;',
  '};',
  '',
  'export function combineRunUsage(openRunUsage: OpenRunUsage | null): TokenUsageAggregate | undefined {',
  '  if (!openRunUsage) return undefined;',
  '  const parts: TokenUsageAggregate[] = [];',
  '  if (openRunUsage.orchestrator) parts.push(openRunUsage.orchestrator);',
  '  for (const id of Object.keys(openRunUsage.subagents).sort()) {',
  '    const usage = openRunUsage.subagents[id];',
  '    if (usage) parts.push(usage);',
  '  }',
  '  if (parts.length === 0) return undefined;',
  '  if (parts.length === 1) return parts[0];',
  '  let latest = parts[0].latest;',
  '  let peak = parts[0].peak;',
  '  let cumulative = parts[0].cumulative;',
  '  let samples = parts[0].samples;',
  '  let streamStartedAt = parts[0].streamStartedAt;',
  '  let streamEndedAt = parts[0].streamEndedAt;',
  '  for (let i = 1; i < parts.length; i++) {',
  '    const o = parts[i];',
  '    latest = {',
  '      promptTokens: latest.promptTokens + o.latest.promptTokens,',
  '      completionTokens: latest.completionTokens + o.latest.completionTokens,',
  '      totalTokens: latest.totalTokens + o.latest.totalTokens',
  '    };',
  '    cumulative = {',
  '      promptTokens: cumulative.promptTokens + o.cumulative.promptTokens,',
  '      completionTokens: cumulative.completionTokens + o.cumulative.completionTokens,',
  '      totalTokens: cumulative.totalTokens + o.cumulative.totalTokens',
  '    };',
  '    peak = {',
  '      promptTokens: Math.max(peak.promptTokens, o.peak.promptTokens),',
  '      completionTokens: Math.max(peak.completionTokens, o.peak.completionTokens),',
  '      totalTokens: Math.max(peak.totalTokens, o.peak.totalTokens)',
  '    };',
  '    samples += o.samples;',
  '    if (typeof o.streamStartedAt === "number") {',
  '      streamStartedAt =',
  '        typeof streamStartedAt === "number"',
  '          ? Math.min(streamStartedAt, o.streamStartedAt)',
  '          : o.streamStartedAt;',
  '    }',
  '    if (typeof o.streamEndedAt === "number") {',
  '      streamEndedAt =',
  '        typeof streamEndedAt === "number"',
  '          ? Math.max(streamEndedAt, o.streamEndedAt)',
  '          : o.streamEndedAt;',
  '    }',
  '  }',
  '  const out: TokenUsageAggregate = { latest, peak, cumulative, samples };',
  '  if (typeof streamStartedAt === "number") out.streamStartedAt = streamStartedAt;',
  '  if (typeof streamEndedAt === "number") out.streamEndedAt = streamEndedAt;',
  '  return out;',
  '}',
  '',
  'export function flushRunToRows(',
  '  out: import("../deriveRows.js").Row[],',
  '  openRun: OpenRun | null,',
  '  openRunUsage: OpenRunUsage | null',
  '): { openRun: OpenRun | null; openRunUsage: OpenRunUsage | null } {',
  '  if (!openRun) return { openRun, openRunUsage };',
  '  const durationMs = openRun.lastTs - openRun.promptTs;',
  '  if (durationMs > 0) {',
  '    const usage = combineRunUsage(openRunUsage);',
  '    out.push({',
  "      kind: 'run-complete',",
  '      key: `done:${openRun.promptId}`,',
  '      durationMs,',
  '      ...(usage !== undefined ? { usage } : {})',
  '    });',
  '  }',
  '  return { openRun: null, openRunUsage: null };',
  '}',
  ''
].join('\n');

fs.writeFileSync(`${dir}/runBoundaries.ts`, runHeader);

console.log('split complete');
