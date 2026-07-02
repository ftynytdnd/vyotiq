/**
 * AI-assisted commit messages: Conventional Commits subject + natural-language body.
 * @see https://www.conventionalcommits.org/en/v1.0.0/
 */

import type { ChatMessage } from '@shared/types/chat.js';
import {
  analyzeBreakingChanges,
  messageSignalsBreakingChange
} from '@shared/git/breakingChangeHeuristics.js';
import { analyzeCommitHistoryStyle } from '@shared/git/commitHistoryStyle.js';
import {
  isQualityCommitMessage,
  isValidConventionalCommitMessage,
  sanitizeModelCommitMessage
} from '@shared/git/conventionalCommit.js';
import {
  buildDeterministicCommitMessage,
  classifyDeterministicCommit
} from '@shared/git/deterministicCommitMessage.js';
import { commitMessageSubject, normalizeCommitMessage } from '@shared/git/normalizeCommitMessage.js';
import { resolveGitCommitMessageModel } from '@shared/git/resolveGitCommitMessageModel.js';
import { wrapCommitMessageBody } from '@shared/git/wrapCommitMessageBody.js';
import { streamChat } from '../providers/chatClient.js';
import { listProviders } from '../providers/providerStore.js';
import { getSettings } from '../settings/settingsStore.js';
import { logger } from '../logging/logger.js';
import { GitUserError } from './gitUserError.js';
import type { WorkspaceGitRun } from './workspaceGitRunner.js';
import {
  buildCommitChangeAnalysis,
  buildCommitChangeSummary,
  buildCommitDiffContext,
  buildCommitHistorySamples,
  buildCommitProjectHints,
  buildPerFileDiffBlocks,
  listCommitRelevantPaths,
  type CommitDiffContext,
  type PerFileDiffBlock
} from './workspaceGitCommitDiff.js';

const log = logger.child('workspace/git-commit-message');
const MAX_TOKENS = 1_100;
const MAP_REDUCE_BATCH_SIZE = 8;
const MAP_REDUCE_SUMMARY_TOKENS = 450;

const COMMIT_MESSAGE_SYSTEM_PROMPT =
  'You write git commit messages the way a thoughtful senior engineer would — clear, human, and specific.\n' +
  'Output ONLY the commit message. No markdown fences, quotes, or commentary.\n\n' +
  'STRUCTURE:\n' +
  'Line 1 — Conventional Commits subject: type(optional-scope): short imperative summary (≤72 chars)\n' +
  'Line 2 — blank\n' +
  'Lines 3+ — body in natural language (full sentences, paragraphs)\n' +
  'Optional footers after a blank line: BREAKING CHANGE:, Closes #123, etc.\n\n' +
  'SUBJECT (machine-readable, keep conventional):\n' +
  '- Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert\n' +
  '- Scope MUST come from file paths in the diff — omit scope if unclear, never invent one\n' +
  '- Imperative, lowercase type, no trailing period, do not repeat the scope in the description\n' +
  '- Add `!` after type/scope only for backward-incompatible changes\n\n' +
  'BODY (human-readable — this is what teammates actually read):\n' +
  '- Write 2–4 short paragraphs in plain English explaining what changed and why it matters\n' +
  '- Name real modules, routes, components, and config files you see in the diff\n' +
  '- Describe behavior and intent, not a file checklist\n' +
  '- DO NOT use bullet lists or lines starting with "- add"\n' +
  '- DO NOT repeat the subject line or stack robotic "add X / add Y" phrases\n' +
  '- Wrap body lines at ~72 characters when possible\n' +
  '- For large imports: explain what the project is, what users can do with it, and how major pieces fit together\n' +
  '- Only state facts grounded in the diff and project hints — never invent features\n\n' +
  'EXAMPLE:\n' +
  'feat(ai-agent-landing): introduce marketing site and agent dashboard\n\n' +
  'This brings in the ai-agent-landing Next.js app as a first working scaffold. The public ' +
  'surface covers landing, pricing, and sign-in, while the signed-in dashboard lets operators ' +
  'review agents, workflows, billing, and integration health from one place.\n\n' +
  'Persistence is set up with Drizzle and PostgreSQL, and the standard Next.js toolchain ' +
  '(eslint, tsconfig, next.config) is included so the repo can be developed immediately. ' +
  'Public SVG assets and global styles ship with the initial routes.';

const MAP_REDUCE_SYSTEM_PROMPT =
  'You summarize git file changes for a commit message draft.\n' +
  'For each file below, output exactly one line: path: one-sentence intent (what changed and why).\n' +
  'No markdown, no numbering, no preamble. Ground every line in the diff shown.';

export interface GenerateGitCommitMessageOpts {
  onDelta?: (delta: string) => void;
}

export interface GenerateGitCommitMessageResult {
  message: string;
  warnings: string[];
}

async function streamCommitMessage(
  modelSel: { providerId: string; modelId: string },
  messages: ChatMessage[],
  opts?: { onDelta?: (delta: string) => void; maxTokens?: number; temperature?: number }
): Promise<string> {
  let raw = '';
  let reasoning = '';
  const emitDelta = (chunk: string) => {
    if (!chunk) return;
    opts?.onDelta?.(chunk);
  };
  for await (const delta of streamChat({
    providerId: modelSel.providerId,
    model: modelSel.modelId,
    messages,
    toolChoice: 'none',
    temperature: opts?.temperature ?? 0.35,
    maxTokens: opts?.maxTokens ?? MAX_TOKENS
  })) {
    if (delta.contentDelta) {
      raw += delta.contentDelta;
      emitDelta(delta.contentDelta);
    } else if (delta.reasoningDelta) {
      reasoning += delta.reasoningDelta;
    }
    if (delta.finishReason === 'error') break;
  }
  return raw.trim() ? raw : reasoning;
}

function buildDiffWarnings(ctx: CommitDiffContext | null): string[] {
  if (!ctx) return [];
  const warnings: string[] = [];
  if (ctx.oversized) {
    warnings.push(
      'Diff is very large — the generated message may miss details. Consider splitting into smaller commits.'
    );
  } else if (ctx.truncated) {
    warnings.push(
      'Diff was truncated for analysis — review the message before committing.'
    );
  }
  if (ctx.mapReduceRequired) {
    warnings.push(
      `Large change (${ctx.totalPaths} files) — message was composed from per-file summaries.`
    );
  }
  return warnings;
}

function buildUserPrompt(input: {
  changeSummary: string;
  diffExcerpt: string;
  projectHints: string;
  historySamples: string;
  historyInstruction: string;
  scopeHint: string | null;
  fileCount: number;
  breakingHint: string;
  mapReduceSummaries: string;
  mapReduceRequired: boolean;
}): string {
  const {
    changeSummary,
    diffExcerpt,
    projectHints,
    historySamples,
    historyInstruction,
    scopeHint,
    fileCount,
    breakingHint,
    mapReduceSummaries,
    mapReduceRequired
  } = input;

  const scopeLine = scopeHint ? `\nSuggested scope (from paths): ${scopeHint}` : '';
  const sizeLine =
    fileCount > 8
      ? `\nThis is a large change (${fileCount} paths) — write a detailed multi-paragraph body.`
      : fileCount > 3
        ? `\nWrite at least two paragraphs in the body explaining context and impact.`
        : '';

  const blocks: string[] = [
    `Write a commit message for these changes.${scopeLine}${sizeLine}`
  ];

  if (historyInstruction) {
    blocks.push(`\n## Repository style\n${historyInstruction}`);
  }
  if (historySamples.trim()) {
    blocks.push(`\n## Recent commits (match tone)\n${historySamples.slice(0, 4_000)}`);
  }
  blocks.push(`\n## Change analysis\n${changeSummary}`);

  if (mapReduceRequired && mapReduceSummaries.trim()) {
    blocks.push(`\n## Per-file summaries\n${mapReduceSummaries}`);
    blocks.push(`\n## Priority diff excerpts\n${diffExcerpt}`);
  } else {
    blocks.push(`\n## Diff\n${diffExcerpt}`);
  }

  if (projectHints.trim()) {
    blocks.push(`\n## Project hints\n${projectHints}`);
  }
  if (breakingHint.trim()) {
    blocks.push(`\n## Breaking change signals\n${breakingHint}`);
  }

  return blocks.join('');
}

function retryInstruction(
  validSubject: boolean,
  naturalBody: boolean,
  fileCount: number,
  needsBreaking: boolean
): string {
  const parts = ['Rewrite ONLY the commit message.'];
  if (!validSubject) {
    parts.push('- Subject MUST be: type(scope): imperative description (≤72 chars)');
    parts.push('- Scope must appear in file paths — omit if unclear');
  }
  if (!naturalBody && fileCount > 3) {
    parts.push(
      '- Replace checklist bullets with 2–4 paragraphs of natural language',
      '- Explain what changed, why, and how major areas relate — no "- add …" lines'
    );
  }
  if (needsBreaking) {
    parts.push(
      '- This change looks backward-incompatible — add `!` in the subject or a BREAKING CHANGE: footer'
    );
  }
  parts.push('- No markdown fences or commentary');
  return parts.join('\n');
}

function formatMapReduceBatch(blocks: PerFileDiffBlock[]): string {
  return blocks
    .map((b) => `### ${b.path}\n${b.excerpt}`)
    .join('\n\n');
}

async function buildMapReduceSummaries(
  modelSel: { providerId: string; modelId: string },
  perFileBlocks: PerFileDiffBlock[]
): Promise<string> {
  if (perFileBlocks.length === 0) return '';

  const summaries: string[] = [];
  for (let i = 0; i < perFileBlocks.length; i += MAP_REDUCE_BATCH_SIZE) {
    const batch = perFileBlocks.slice(i, i + MAP_REDUCE_BATCH_SIZE);
    const userContent = formatMapReduceBatch(batch);
    const messages: ChatMessage[] = [
      { role: 'system', content: MAP_REDUCE_SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ];
    try {
      const raw = await streamCommitMessage(modelSel, messages, {
        maxTokens: MAP_REDUCE_SUMMARY_TOKENS,
        temperature: 0.2
      });
      if (raw.trim()) summaries.push(raw.trim());
    } catch (err: unknown) {
      log.warn('map-reduce file summary batch failed', {
        message: err instanceof Error ? err.message : String(err),
        batchStart: i
      });
    }
  }

  return summaries.join('\n');
}

function finalizeCommitMessage(message: string): string {
  return wrapCommitMessageBody(normalizeCommitMessage(message));
}

export async function generateGitCommitMessage(
  gitRun: WorkspaceGitRun,
  workspaceId: string,
  wsPath: string,
  opts?: GenerateGitCommitMessageOpts
): Promise<GenerateGitCommitMessageResult> {
  const settings = await getSettings();
  const providers = await listProviders();
  const modelSel = resolveGitCommitMessageModel(
    {
      providers,
      authoringModel: settings.authoringModel,
      defaultModel: settings.defaultModel,
      lastModelByWorkspace: settings.ui?.lastModelByWorkspace,
      autoModelByWorkspace: settings.ui?.autoModelByWorkspace
    },
    workspaceId
  );
  if (!modelSel) {
    throw new GitUserError('Configure a provider model in Settings → Providers.');
  }

  const [analysis, changeSummary, diffContext, historySamples, relevantPaths] =
    await Promise.all([
      buildCommitChangeAnalysis(gitRun),
      buildCommitChangeSummary(gitRun),
      buildCommitDiffContext(gitRun, wsPath),
      buildCommitHistorySamples(gitRun),
      listCommitRelevantPaths(gitRun)
    ]);

  const projectHints = await buildCommitProjectHints(wsPath, gitRun, analysis);

  const warnings = buildDiffWarnings(diffContext);

  if (!analysis && !changeSummary.trim() && !diffContext?.excerpt.trim()) {
    throw new GitUserError('No changes to summarize.');
  }

  const relevantPathList = relevantPaths?.paths ?? [];
  const deterministicKind = classifyDeterministicCommit(relevantPathList);
  if (deterministicKind) {
    return {
      message: buildDeterministicCommitMessage(deterministicKind, relevantPathList),
      warnings
    };
  }

  const fileCount = analysis?.totalFiles ?? relevantPathList.length;
  const scopeHint = analysis?.primaryScope ?? null;
  const historyStyle = historySamples ? analyzeCommitHistoryStyle(historySamples) : null;
  const historyInstruction = historyStyle?.instruction ?? '';
  const stagedDiff = diffContext?.excerpt ?? '';
  const breaking = analyzeBreakingChanges(stagedDiff, changeSummary);

  let mapReduceSummaries = '';
  if (diffContext?.mapReduceRequired && diffContext.perFileBlocks.length > 0) {
    mapReduceSummaries = await buildMapReduceSummaries(modelSel, diffContext.perFileBlocks);
  }

  const userContent = buildUserPrompt({
    changeSummary: changeSummary.trim() || analysis?.summary || '',
    diffExcerpt: stagedDiff,
    projectHints,
    historySamples,
    historyInstruction,
    scopeHint,
    fileCount,
    breakingHint: breaking.promptHint,
    mapReduceSummaries,
    mapReduceRequired: Boolean(diffContext?.mapReduceRequired)
  });

  const systemPrompt =
    historyStyle?.prefersBullets && !historyStyle.prefersProse
      ? `${COMMIT_MESSAGE_SYSTEM_PROMPT}\n\nWhen the repository style section allows bullets, you may use short bullet lines for distinct changes — still avoid robotic "- add file" checklists.`
      : COMMIT_MESSAGE_SYSTEM_PROMPT;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ];

  let raw = '';
  try {
    raw = await streamCommitMessage(modelSel, messages, { onDelta: opts?.onDelta });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('commit message generation failed', { message: msg });
    throw new Error(msg || 'Could not generate commit message.');
  }

  let message = sanitizeModelCommitMessage(raw);
  const qualityOpts = { fileCount };
  const needsBreakingFooter =
    breaking.likelyBreaking && breaking.confidence !== 'low' && !messageSignalsBreakingChange(message);

  const needsRetry =
    !isValidConventionalCommitMessage(message) ||
    !isQualityCommitMessage(message, qualityOpts) ||
    needsBreakingFooter;

  if (needsRetry) {
    const validSubject = isValidConventionalCommitMessage(message);
    const naturalBody = isQualityCommitMessage(message, qualityOpts);
    log.info('commit message quality retry', {
      subject: commitMessageSubject(message),
      validSubject,
      naturalBody,
      needsBreakingFooter
    });
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: message || raw },
      {
        role: 'user',
        content: retryInstruction(validSubject, naturalBody, fileCount, needsBreakingFooter)
      }
    ];
    try {
      const retryRaw = await streamCommitMessage(modelSel, retryMessages, { onDelta: opts?.onDelta });
      message = sanitizeModelCommitMessage(retryRaw);
    } catch (err: unknown) {
      log.warn('commit message retry failed', {
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  message = finalizeCommitMessage(message);
  if (!commitMessageSubject(message)) {
    throw new Error('Model returned an empty commit message.');
  }
  if (!isValidConventionalCommitMessage(message)) {
    throw new Error(
      'Could not produce a valid Conventional Commits subject. Try again or edit manually.'
    );
  }
  if (!isQualityCommitMessage(message, qualityOpts)) {
    throw new Error(
      'Generated message was too shallow or checklist-like. Try Generate again or edit manually.'
    );
  }

  if (breaking.likelyBreaking && !messageSignalsBreakingChange(message)) {
    warnings.push(
      'Changes may be backward-incompatible — consider adding `!` or a BREAKING CHANGE footer.'
    );
  }

  return { message, warnings };
}
