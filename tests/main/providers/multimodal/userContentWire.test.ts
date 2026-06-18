import { describe, expect, it } from 'vitest';
import { parseDataUrl } from '@main/providers/multimodal/parseDataUrl.js';
import {
  toAnthropicUserBlocks,
  toGeminiUserParts,
  toOllamaUserWire,
  userContentHasMultimodalParts
} from '@main/providers/multimodal/userContentWire.js';

const PNG_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('userContentWire', () => {
  it('parseDataUrl extracts mime and payload', () => {
    const parsed = parseDataUrl(PNG_DATA);
    expect(parsed?.mime).toBe('image/png');
    expect(parsed?.base64.startsWith('iVBOR')).toBe(true);
  });

  it('maps image parts to Anthropic blocks', () => {
    const blocks = toAnthropicUserBlocks([
      { type: 'image_url', image_url: { url: PNG_DATA } },
      { type: 'text', text: '<turn>hi</turn>' }
    ]);
    expect(blocks[0]?.type).toBe('image');
    expect(blocks[1]?.type).toBe('text');
  });

  it('maps image parts to Gemini inlineData', () => {
    const parts = toGeminiUserParts([
      { type: 'image_url', image_url: { url: PNG_DATA } },
      { type: 'text', text: 'describe' }
    ]);
    expect(parts[0]?.inlineData?.mimeType).toBe('image/png');
    expect(parts[1]?.text).toBe('describe');
  });

  it('extracts Ollama images array', () => {
    const wire = toOllamaUserWire([
      { type: 'image_url', image_url: { url: PNG_DATA } },
      { type: 'text', text: 'what is this' }
    ]);
    expect(wire.images?.length).toBe(1);
    expect(wire.content).toContain('what is this');
  });

  it('detects multimodal user content', () => {
    expect(userContentHasMultimodalParts('plain')).toBe(false);
    expect(
      userContentHasMultimodalParts([{ type: 'image_url', image_url: { url: PNG_DATA } }])
    ).toBe(true);
  });
});
