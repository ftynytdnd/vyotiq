/** Human-facing shell label for the cross-platform `bash` tool. */

export type ShellDisplayName = 'powershell' | 'bash';

export function resolveShellToolTitle(platform: string): ShellDisplayName {
  return platform === 'win32' ? 'powershell' : 'bash';
}

/** Map harness tool name to timeline display label (bash → platform shell). */
export function displayToolName(toolName: string, platform: string): string {
  if (toolName === 'bash') return resolveShellToolTitle(platform);
  return toolName;
}
