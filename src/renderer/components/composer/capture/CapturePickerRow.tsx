/**
 * Single capture picker row — shared by static and virtualized lists.
 */

import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../../lib/shellIcons.js';

const CAPTURE_THUMB_WIDTH = 72;
const CAPTURE_THUMB_HEIGHT = 44;

function CaptureThumb({
  src,
  label,
  icon: Icon
}: {
  src?: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <span
      className="vx-capture-picker-thumb"
      style={{ width: CAPTURE_THUMB_WIDTH, height: CAPTURE_THUMB_HEIGHT }}
      aria-hidden
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="vx-capture-picker-thumb__img"
          draggable={false}
        />
      ) : (
        <span className="vx-capture-picker-thumb__placeholder">
          <Icon className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface CapturePickerRowProps {
  rowId: string;
  label: string;
  subtitle?: string;
  thumbnailSrc?: string;
  icon: LucideIcon;
  disabled?: boolean;
  active?: boolean;
  capturing?: boolean;
  onFocus?: () => void;
  onClick: () => void;
}

export function CapturePickerRow({
  rowId,
  label,
  subtitle,
  thumbnailSrc,
  icon,
  disabled,
  active,
  capturing,
  onFocus,
  onClick
}: CapturePickerRowProps) {
  return (
    <button
      type="button"
      role="menuitem"
      id={`capture-row-${rowId}`}
      disabled={disabled}
      onFocus={onFocus}
      onClick={onClick}
      className={cn(
        'vx-capture-picker-row',
        active && 'vx-capture-picker-row--active',
        capturing && 'vx-capture-picker-row--capturing',
        disabled && 'vx-capture-picker-row--disabled'
      )}
    >
      <CaptureThumb src={thumbnailSrc} label={label} icon={icon} />
      <span className="vx-capture-picker-row__text">
        <span className="vx-capture-picker-row__label">{label}</span>
        {subtitle ? <span className="vx-capture-picker-row__subtitle">{subtitle}</span> : null}
      </span>
    </button>
  );
}

export function CapturePickerSkeletonRows() {
  return (
    <div className="vx-capture-picker-loading" aria-busy="true" aria-label="Loading capture sources">
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="vx-capture-picker-row vx-capture-picker-row--skeleton">
          <span
            className="vx-capture-picker-thumb vx-capture-picker-thumb--skeleton"
            style={{ width: CAPTURE_THUMB_WIDTH, height: CAPTURE_THUMB_HEIGHT }}
          />
          <span className="vx-capture-picker-row__text">
            <span className="vx-capture-picker-skeleton-line vx-capture-picker-skeleton-line--wide" />
            <span className="vx-capture-picker-skeleton-line" />
          </span>
        </div>
      ))}
    </div>
  );
}
