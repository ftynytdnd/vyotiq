import { describe, expect, it } from 'vitest';
import { parseAskUserArgs, formatAskUserDisplayText } from '@shared/text/parseAskUser';

describe('parseAskUserArgs', () => {
  it('parses structured questions', () => {
    const out = parseAskUserArgs({
      title: 'Scope',
      questions: [
        {
          id: 'q1',
          prompt: 'Drop the column?',
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' }
          ]
        }
      ]
    });
    expect(out.structured?.questions).toHaveLength(1);
    expect(out.displayText).toContain('Drop the column?');
  });

  it('accepts legacy question string', () => {
    const out = parseAskUserArgs({ question: 'Which API?' });
    expect(out.legacyQuestion).toBe('Which API?');
    expect(out.displayText).toBe('Which API?');
  });

  it('formats multi-question display text', () => {
    const text = formatAskUserDisplayText({
      title: 'T',
      questions: [
        {
          id: 'a',
          prompt: 'First?',
          options: [{ id: 'x', label: 'X' }]
        }
      ]
    });
    expect(text).toContain('T');
    expect(text).toContain('First?');
  });
});
