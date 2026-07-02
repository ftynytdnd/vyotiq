/** Branch chip suffix for upstream sync (e.g. `main ↑2 ↓1`). */
export function formatBranchSyncSuffix(ahead?: number, behind?: number): string {
  const parts: string[] = [];
  if (ahead != null && ahead > 0) parts.push(`↑${ahead}`);
  if (behind != null && behind > 0) parts.push(`↓${behind}`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function formatBranchChipLabel(
  branch: string,
  ahead?: number,
  behind?: number
): string {
  return `${branch}${formatBranchSyncSuffix(ahead, behind)}`;
}
