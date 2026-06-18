/**
 * `capture` tool — screenshot the Globe browser, a screen/window source, or Vyotiq window.
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import { captureByTarget } from '../capture/captureManager.js';
import { queueWorkspaceVision } from '../orchestrator/runVisionQueue.js';

interface CaptureArgs {
  target: 'browser' | 'screen' | 'window';
  sourceId?: string;
}

export const captureTool: Tool = {
  name: 'capture',
  briefMarkdown: `### Tool: \`capture\`

**WHAT it is.** Captures a screenshot into the workspace (\`.vyotiq/captures/\`) and queues native vision for the next turn.

**HOW to use it.**
\`\`\`json
{ "name": "capture", "arguments": { "target": "browser" } }
\`\`\`
Targets: \`browser\` (Globe tab), \`window\` (Vyotiq UI), \`screen\` (requires \`sourceId\` from list — use when user names a display).

**WHY it exists.** Let you see UI state, browser pages, or desktop context the user refers to.`,
  schema: {
    type: 'function',
    function: {
      name: 'capture',
      description:
        'Capture a screenshot to the workspace and queue vision for the next assistant turn.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['browser', 'screen', 'window'],
            description: 'What to capture.'
          },
          sourceId: {
            type: 'string',
            description: 'Required when target is screen — desktopCapturer source id.'
          }
        },
        required: ['target']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<CaptureArgs>;
    if (a.target !== 'browser' && a.target !== 'screen' && a.target !== 'window') {
      return {
        id,
        name: 'capture',
        ok: false,
        output: 'Error: `target` must be browser, screen, or window.',
        error: 'invalid target',
        durationMs: Date.now() - started
      };
    }
    if (a.target === 'screen' && (!a.sourceId || !a.sourceId.trim())) {
      return {
        id,
        name: 'capture',
        ok: false,
        output: 'Error: `sourceId` is required when target is screen.',
        error: 'missing sourceId',
        durationMs: Date.now() - started
      };
    }
    try {
      const result = await captureByTarget(
        ctx.workspacePath,
        a.target,
        a.sourceId?.trim()
      );
      queueWorkspaceVision(ctx.runId, {
        path: result.relPath,
        kind: 'image',
        source: 'capture'
      });
      return {
        id,
        name: 'capture',
        ok: true,
        output:
          `Captured ${a.target} screenshot → ${result.relPath} (${result.width}×${result.height}, ${result.bytes} bytes). ` +
          'Vision queued for next turn.',
        durationMs: Date.now() - started
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id,
        name: 'capture',
        ok: false,
        output: `Capture failed: ${msg}`,
        error: msg,
        durationMs: Date.now() - started
      };
    }
  }
};
