/**
 * Timeline find highlight helpers + debounced query contract.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import {
  TimelineFindBar,
  clearFindMarks,
  highlightMatches
} from '@renderer/components/timeline/shared/TimelineFindBar.js';

describe('highlightMatches', () => {
  it('wraps case-insensitive matches in mark elements', () => {
    const root = document.createElement('div');
    root.textContent = 'Hello world hello';
    document.body.appendChild(root);

    const count = highlightMatches(root, 'hello');
    expect(count).toBe(2);
    expect(root.querySelectorAll('mark.vyotiq-timeline-find-mark')).toHaveLength(2);

    clearFindMarks(root);
    document.body.removeChild(root);
  });
});

describe('TimelineFindBar debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces highlight work until the user pauses typing', () => {
    const root = document.createElement('div');
    root.textContent = 'find me find me';
    document.body.appendChild(root);
    const rootRef = { current: root };

    render(<TimelineFindBar open onClose={() => undefined} rootRef={rootRef} />);

    const input = screen.getByLabelText('Find in conversation');
    fireEvent.change(input, { target: { value: 'find' } });

    expect(root.querySelectorAll('mark.vyotiq-timeline-find-mark').length).toBe(0);

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(root.querySelectorAll('mark.vyotiq-timeline-find-mark').length).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(root.querySelectorAll('mark.vyotiq-timeline-find-mark').length).toBeGreaterThan(0);

    clearFindMarks(root);
    document.body.removeChild(root);
  });

  it('steps through matches with Enter and Shift+Enter', () => {
    const root = document.createElement('div');
    root.textContent = 'alpha beta alpha';
    document.body.appendChild(root);
    const rootRef = { current: root };
    const scrollSpy = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView');

    render(<TimelineFindBar open onClose={() => undefined} rootRef={rootRef} />);

    const input = screen.getByLabelText('Find in conversation');
    fireEvent.change(input, { target: { value: 'alpha' } });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByText('1/2')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(scrollSpy).toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(screen.getByText('1/2')).toBeInTheDocument();

    scrollSpy.mockRestore();
    clearFindMarks(root);
    document.body.removeChild(root);
  });
});
