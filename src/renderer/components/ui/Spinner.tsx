import { cn } from '../../lib/cn.js';

interface SpinnerProps {
  className?: string;
  size?: number;
}

export function Spinner({ className, size = 14 }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin text-text-muted', className)}
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" fill="none" />
      <path
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z"
      />
    </svg>
  );
}
