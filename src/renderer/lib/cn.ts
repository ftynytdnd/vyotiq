/**
 * cn — tiny class-name composition helper. Keeps JSX tidy without bringing
 * in a heavier framework.
 */

import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(...inputs);
}
