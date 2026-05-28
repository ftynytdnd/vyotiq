/**
 * Subtle labels above timeline content — turn eyebrows and code fences.
 */

import { cn } from '../../../lib/cn.js';
import { timelineEyebrowClassName } from './rowStyles.js';

interface TimelineEyebrowProps {
  label: string;
  className?: string;
  /** When set, exposes the label to assistive tech instead of hiding it. */
  accessibleLabel?: string;
}

/** Quiet uppercase label at the start of a turn block (You, Agent V). */
export function TimelineEyebrow({ label, className, accessibleLabel }: TimelineEyebrowProps) {
  return (
    <div
      className={cn(timelineEyebrowClassName, className)}
      {...(accessibleLabel ? { 'aria-label': accessibleLabel } : { 'aria-hidden': true })}
    >
      {label}
    </div>
  );
}

interface CodeLanguageEyebrowProps {
  language: string;
  className?: string;
}

export function CodeLanguageEyebrow({ language, className }: CodeLanguageEyebrowProps) {
  return (
    <div
      className={cn(
        'mb-0.5 font-mono text-meta uppercase tracking-wide text-text-faint',
        className
      )}
      aria-hidden
    >
      {language}
    </div>
  );
}
