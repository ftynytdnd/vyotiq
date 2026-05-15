import React from 'react';
import { cn } from '../../lib/cn.js';

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  trailing?: React.ReactNode;
}

export function NavItem({ icon, label, active, onClick, trailing }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'app-no-drag flex w-full items-center gap-2.5 rounded-inner px-2.5 py-1.5 text-left text-row',
        'transition-colors duration-150',
        active
          ? 'bg-surface-hover text-text-primary'
          : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
