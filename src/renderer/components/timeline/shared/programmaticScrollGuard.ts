/**
 * Holds a ref true across programmatic scroll + layout settle so user-lock
 * heuristics do not fire on tail-pin side effects.
 */

export function runWithProgrammaticScrollGuard(
  guardRef: { current: boolean },
  pin: () => void,
  onSettled?: () => void
): void {
  guardRef.current = true;
  pin();

  const settle = (): void => {
    guardRef.current = false;
    onSettled?.();
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(settle);
  });
}
