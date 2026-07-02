import type { GitHubGitProgress } from '../types/github.js';

function trimLine(line: string, max = 72): string {
  const t = line.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** User-facing toast / chip label for a git progress event. */
export function formatGitProgressMessage(payload: GitHubGitProgress): string {
  const repo = `${payload.owner}/${payload.repo}`;
  const branch = payload.branch ? ` (${payload.branch})` : '';
  const detail = payload.line ? ` — ${trimLine(payload.line)}` : '';

  switch (payload.kind) {
    case 'clone':
      return `Cloning ${repo}${branch}…${detail}`;
    case 'fetch':
      return `Fetching ${repo}${branch}…${detail}`;
    case 'checkout':
      return `Checking out ${repo}${branch}…${detail}`;
    case 'pull':
      return `Pulling ${repo}${branch}…${detail}`;
    default: {
      const _exhaustive: never = payload.kind;
      void _exhaustive;
      return `Syncing ${repo}…`;
    }
  }
}
