/**
 * Retry a failed dynamic `import()` once. Used by `React.lazy` boundaries
 * so a stale chunk after a dev rebuild or app update can recover without
 * a manual reload — `main.tsx` also listens for `vite:preloadError` as a
 * last-resort full-page reload.
 */

const RETRY_DELAY_MS = 50;

function isChunkLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('failed to load module script')
  );
}

export async function retryDynamicImport<T>(importFn: () => Promise<T>): Promise<T> {
  try {
    return await importFn();
  } catch (err) {
    if (!isChunkLoadError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return importFn();
  }
}
