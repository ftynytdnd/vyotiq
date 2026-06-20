/** Wait two animation frames so suppressed UI can paint before desktop capture. */
export function waitForCompositorPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
