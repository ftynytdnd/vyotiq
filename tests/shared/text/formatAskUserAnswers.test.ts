import { describe, expect, it } from 'vitest';
import {
  formatAskUserDisplayFromAnswers,
  formatAskUserReplyBubble,
  formatAskUserToolResult
} from '@shared/text/formatAskUserAnswers';

describe('formatAskUserAnswers', () => {
  const payload = {
    title: 'Scope',
    questions: [
      {
        id: 'drop',
        prompt: 'Drop column?',
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' }
        ]
      }
    ]
  };

  it('formats selected options and supplement text', () => {
    const text = formatAskUserDisplayFromAnswers(
      payload,
      [{ questionId: 'drop', selectedOptionIds: ['no'] }],
      'Also check indexes.'
    );
    expect(text).toContain('Drop column?');
    expect(text).toContain('No (no)');
    expect(text).toContain('Also check indexes.');
  });

  it('wraps tool result for the orchestrator', () => {
    const out = formatAskUserToolResult(payload, [
      { questionId: 'drop', selectedOptionIds: ['yes'] }
    ]);
    expect(out).toMatch(/^User answers:/);
    expect(out).toContain('Yes (yes)');
  });

  it('formats compact reply bubble with answers only', () => {
    const multiPayload = {
      questions: [
        {
          id: 'path',
          prompt: 'Where is the source code located?',
          options: [{ id: 'wrong_path', label: "I'm looking in the wrong directory" }]
        }
      ]
    };
    expect(
      formatAskUserReplyBubble(multiPayload, [
        { questionId: 'path', selectedOptionIds: ['wrong_path'], freeText: 'hihjihi' }
      ])
    ).toBe("I'm looking in the wrong directory — hihjihi");

    expect(
      formatAskUserReplyBubble(payload, [{ questionId: 'drop', selectedOptionIds: ['no'] }])
    ).toBe('No');
  });
});
