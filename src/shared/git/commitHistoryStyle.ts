/**
 * Infer commit-message style from recent git history samples.
 */

const CONVENTIONAL_SUBJECT_RE =
  /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^)]+\))?!?:\s/i;

export interface CommitHistoryStyle {
  sampleCount: number;
  conventionalRatio: number;
  prefersBullets: boolean;
  prefersProse: boolean;
  dominantLanguage: 'english' | 'non-english' | 'mixed' | 'unknown';
  instruction: string;
}

function splitHistorySamples(log: string): Array<{ subject: string; body: string }> {
  const commits: Array<{ subject: string; body: string }> = [];
  for (const block of log.split(/\n---\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    const subject = lines[0]?.trim() ?? '';
    if (!subject) continue;
    const body = lines.slice(1).join('\n').trim();
    commits.push({ subject, body });
  }
  return commits;
}

function looksNonEnglish(text: string): boolean {
  if (!text.trim()) return false;
  const asciiLetters = (text.match(/[a-zA-Z]/g) ?? []).length;
  const allLetters = (text.match(/\p{L}/gu) ?? []).length;
  if (allLetters === 0) return false;
  return asciiLetters / allLetters < 0.55;
}

/**
 * Derive prompt instructions from recent repository commit history.
 */
export function analyzeCommitHistoryStyle(log: string): CommitHistoryStyle | null {
  const commits = splitHistorySamples(log);
  if (commits.length === 0) return null;

  let conventional = 0;
  let bulletBodies = 0;
  let proseBodies = 0;
  let nonEnglish = 0;

  for (const { subject, body } of commits) {
    if (CONVENTIONAL_SUBJECT_RE.test(subject)) conventional++;

    if (body) {
      const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
      const bulletLines = lines.filter((l) => /^[-*]\s/.test(l));
      if (bulletLines.length >= Math.max(2, Math.ceil(lines.length * 0.5))) {
        bulletBodies++;
      } else if (body.length >= 80 && /[.!?]/.test(body)) {
        proseBodies++;
      }
    }

    if (looksNonEnglish(`${subject}\n${body}`)) nonEnglish++;
  }

  const sampleCount = commits.length;
  const conventionalRatio = conventional / sampleCount;
  const prefersBullets = bulletBodies > proseBodies && bulletBodies >= 2;
  const prefersProse = proseBodies > bulletBodies && proseBodies >= 2;

  let dominantLanguage: CommitHistoryStyle['dominantLanguage'] = 'unknown';
  if (nonEnglish === 0) dominantLanguage = 'english';
  else if (nonEnglish >= sampleCount * 0.7) dominantLanguage = 'non-english';
  else dominantLanguage = 'mixed';

  const parts: string[] = [
    'Match the tone and structure of recent commits in this repository.',
    `Recent history: ${sampleCount} commits sampled; ${Math.round(conventionalRatio * 100)}% use Conventional Commits subjects.`
  ];

  if (dominantLanguage === 'non-english') {
    parts.push('Write the commit message in the same non-English language as recent history.');
  } else if (dominantLanguage === 'mixed') {
    parts.push('Follow the language used in the most recent commits.');
  }

  if (prefersBullets) {
    parts.push(
      'This repo often uses bullet points in the body — you may use concise bullets for distinct changes, but avoid robotic "- add file" checklists.'
    );
  } else if (prefersProse) {
    parts.push('This repo uses narrative paragraph bodies — prefer 2–4 prose paragraphs over bullet lists.');
  }

  if (conventionalRatio >= 0.6) {
    parts.push('Keep the Conventional Commits subject format consistent with recent history.');
  }

  return {
    sampleCount,
    conventionalRatio,
    prefersBullets,
    prefersProse,
    dominantLanguage,
    instruction: parts.join('\n')
  };
}
