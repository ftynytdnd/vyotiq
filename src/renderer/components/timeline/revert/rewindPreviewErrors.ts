export function explainPreviewError(error: {
  kind: string;
  conversationId?: string;
  promptEventId?: string;
  hash?: string;
  message?: string;
  runId?: string;
}): string {
  switch (error.kind) {
    case 'unknown-conversation':
      return 'This conversation has no recorded events to rewind.';
    case 'unknown-prompt':
      return 'This message is no longer in the transcript — it may have already been rewound.';
    case 'no-run-binding':
      return 'No file changes are linked to this message — there is nothing to revert.';
    case 'blob-missing':
      return `A snapshot blob is missing on disk${error.hash ? ` (${error.hash.slice(0, 8)}…)` : ''}.`;
    case 'sandbox':
      return error.message ?? 'Revert blocked by sandbox boundary.';
    case 'fs':
      return error.message ?? 'Filesystem error.';
    default:
      return `Unknown error (${error.kind}).`;
  }
}
