/**
 * Strip Electron `invoke()` wrapper text from rejection messages.
 */

function stripGitUserErrorPrefix(text: string): string {
  return text.replace(/^GitUserError:\s*/, '').trim();
}

export function unwrapIpcInvokeError(raw: string): string {
  const trimmed = raw.trim();
  const invokeMatch = trimmed.match(
    /Error invoking remote method (?:'[^']*'|"[^"]*"): (?:(?:Error|GitUserError): )?(.+)$/s
  );
  if (invokeMatch?.[1]) {
    return stripGitUserErrorPrefix(invokeMatch[1].trim());
  }
  return stripGitUserErrorPrefix(trimmed);
}
