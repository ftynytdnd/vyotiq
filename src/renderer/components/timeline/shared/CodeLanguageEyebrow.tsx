/**
 * Subtle labels above timeline content — turn eyebrows and code fences.
 */

import { cn } from '../../../lib/cn.js';

interface CodeLanguageEyebrowProps {
  language: string;
  className?: string;
}

export function CodeLanguageEyebrow({ language, className }: CodeLanguageEyebrowProps) {
  return (
    <div
      className={cn('vx-timeline-eyebrow', className)}
      aria-hidden
    >
      {language}
    </div>
  );
}
