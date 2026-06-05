/** Sync host OS platform from preload (`process.platform` in main). */
export function getHostPlatform(): string {
  if (typeof window !== 'undefined' && window.vyotiq?.app?.platform) {
    return window.vyotiq.app.platform;
  }
  return 'linux';
}
