import { describe, expect, it } from 'vitest';
import { scrollMentionRowIntoView } from '@renderer/components/composer/mention/scrollMentionRowIntoView';

describe('scrollMentionRowIntoView', () => {
  it('scrolls down when the active row is below the container viewport', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', { writable: true, value: 0 });
    Object.defineProperty(container, 'clientHeight', { value: 100 });
    container.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 200,
        left: 0,
        right: 200,
        width: 200,
        height: 100,
        x: 0,
        y: 100,
        toJSON: () => ({})
      }) as DOMRect;

    const row = document.createElement('button');
    row.getBoundingClientRect = () =>
      ({
        top: 220,
        bottom: 244,
        left: 0,
        right: 200,
        width: 200,
        height: 24,
        x: 0,
        y: 220,
        toJSON: () => ({})
      }) as DOMRect;

    scrollMentionRowIntoView(container, row);
    expect(container.scrollTop).toBe(44);
  });

  it('scrolls up when the active row is above the container viewport', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', { writable: true, value: 80 });
    Object.defineProperty(container, 'clientHeight', { value: 100 });
    container.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 200,
        left: 0,
        right: 200,
        width: 200,
        height: 100,
        x: 0,
        y: 100,
        toJSON: () => ({})
      }) as DOMRect;

    const row = document.createElement('button');
    row.getBoundingClientRect = () =>
      ({
        top: 84,
        bottom: 108,
        left: 0,
        right: 200,
        width: 200,
        height: 24,
        x: 0,
        y: 84,
        toJSON: () => ({})
      }) as DOMRect;

    scrollMentionRowIntoView(container, row);
    expect(container.scrollTop).toBe(64);
  });
});
