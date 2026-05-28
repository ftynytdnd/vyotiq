import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TimelineRowHeader } from '@renderer/components/timeline/shared/TimelineRowHeader';

describe('TimelineRowHeader', () => {
  it('renders a div instead of a disabled button when not expandable', () => {
    const { container } = render(
      <TimelineRowHeader expanded={false} onToggle={() => {}} expandable={false}>
        Static label
      </TimelineRowHeader>
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('Static label');
  });
});
