/**
 * Sanity smoke for the renderer test harness.
 * - happy-dom is active.
 * - `window.vyotiq` IPC stub is wired.
 * - React + Testing Library can mount a trivial component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('renderer test harness', () => {
  it('happy-dom provides a window object', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('exposes window.vyotiq stub', () => {
    expect(window.vyotiq).toBeDefined();
    expect(typeof window.vyotiq.workspace.pickDirectory).toBe('function');
    expect(typeof window.vyotiq.tokens.estimate).toBe('function');
  });

  it('renders a trivial React component', () => {
    function Hello() {
      return <div data-testid="hi">hello</div>;
    }
    render(<Hello />);
    expect(screen.getByTestId('hi')).toHaveTextContent('hello');
  });
});
