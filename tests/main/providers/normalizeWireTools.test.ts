import { describe, expect, it } from 'vitest';
import { normalizeWireTools } from '@main/providers/normalizeWireTools.js';

describe('normalizeWireTools', () => {
  it('sorts parameter object keys deterministically', () => {
    const tools = normalizeWireTools([
      {
        type: 'function',
        function: {
          name: 'read',
          description: 'read file',
          parameters: {
            type: 'object',
            properties: { z: { type: 'string' }, a: { type: 'number' } },
            required: ['a']
          }
        }
      }
    ]);
    const params = tools![0]!.function.parameters as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(params.properties)).toEqual(['a', 'z']);
  });
});
