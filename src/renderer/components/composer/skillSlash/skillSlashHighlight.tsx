/**
 * Inline filter highlight for skill slash picker rows.
 */

import type { ReactNode } from 'react';

export function highlightSkillName(name: string, query: string): ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return `/${name}`;

  const lower = name.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return `/${name}`;

  return (
    <>
      /{name.slice(0, idx)}
      <mark className="vx-skill-slash-picker-mark">{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </>
  );
}
