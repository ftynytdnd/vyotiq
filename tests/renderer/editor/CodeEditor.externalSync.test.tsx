import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CodeEditor } from '../../../src/renderer/components/editor/CodeEditor.js';

describe('CodeEditor external sync', () => {
  it('does not call onChange when the value prop is synced from the store', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CodeEditor value="" filePath="main.py" active onChange={onChange} />
    );

    rerender(<CodeEditor value={'print("hi")\n'} filePath="main.py" active onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
