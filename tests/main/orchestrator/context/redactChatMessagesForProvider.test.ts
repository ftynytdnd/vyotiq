import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { redactUserHomeInText } from '@shared/path/redactUserHomeInPath.js';
import { redactChatMessagesForProvider } from '@main/orchestrator/context/redactChatMessagesForProvider.js';

describe('redactUserHomeInText', () => {
  it('redacts profile paths embedded in tool output lines', () => {
    const home = os.homedir();
    const line =
      process.platform === 'win32'
        ? `ENOENT: no such file, open '${home}\\Documents\\agent\\main.py'`
        : `ENOENT: no such file, open '${home}/Documents/agent/main.py'`;
    const out = redactUserHomeInText(line);
    if (process.platform === 'win32') {
      expect(out).toContain("%USERPROFILE%\\Documents\\agent\\main.py");
      expect(out).not.toContain(home);
    } else {
      expect(out).toContain('~/Documents/agent/main.py');
      expect(out).not.toContain(home);
    }
  });
});

describe('redactChatMessagesForProvider', () => {
  it('redacts tool message content and assistant tool_call arguments', () => {
    const home = os.homedir();
    const rawPath =
      process.platform === 'win32' ? `${home}\\repo\\a.ts` : `${home}/repo/a.ts`;
    const redacted = redactChatMessagesForProvider([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: {
              name: 'read',
              arguments: JSON.stringify({ path: rawPath })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'c1',
        name: 'read',
        content: `Error opening ${rawPath}`
      }
    ]);
    const args = redacted[0]?.tool_calls?.[0]?.function.arguments ?? '';
    const toolBody = redacted[1]?.content ?? '';
    if (process.platform === 'win32') {
      expect(args).toContain('%USERPROFILE%');
      expect(toolBody).toContain('%USERPROFILE%');
    } else {
      expect(args).toContain('~/repo/a.ts');
      expect(toolBody).toContain('~/repo/a.ts');
    }
    expect(args).not.toContain(home);
    expect(toolBody).not.toContain(home);
  });
});
