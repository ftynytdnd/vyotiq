/**
 * External markdown link with renderer-side href allowlisting.
 */

import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';
import { mdSafeHref } from './mdSafeHref.js';

interface MdLinkProps {
  href?: string;
  children: ReactNode;
  className?: string;
}

export function MdLink({ href, children, className }: MdLinkProps) {
  const safeHref = mdSafeHref(href);
  if (!safeHref) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noreferrer noopener"
      referrerPolicy="no-referrer"
      className={cn(
        'text-accent underline decoration-accent/40 underline-offset-2',
        className
      )}
    >
      {children}
    </a>
  );
}
