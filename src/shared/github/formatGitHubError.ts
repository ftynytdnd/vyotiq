import { unwrapIpcInvokeError } from '../ipc/unwrapIpcInvokeError.js';

export const GITHUB_OAUTH_NOT_CONFIGURED_MESSAGE =
  'Browser sign-in is not set up in this build. Paste a personal access token below, or use Advanced → OAuth client ID for a custom GitHub Enterprise app.';

export function formatGitHubIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const message = unwrapIpcInvokeError(raw);
  if (
    /GitHub OAuth is not configured/i.test(message) ||
    /browser sign-in is not available in this build/i.test(message)
  ) {
    return GITHUB_OAUTH_NOT_CONFIGURED_MESSAGE;
  }
  return message;
}
