import { resolveGitHubOAuthClientIdFromRuntime } from '@shared/github/resolveOAuthClientId.js';
import { readBlob } from '../settings/blob.js';

export async function isGitHubOAuthConfigured(): Promise<boolean> {
  const blob = await readBlob();
  return resolveGitHubOAuthClientIdFromRuntime(blob.ui?.githubOAuthClientId) != null;
}