import { describe, expect, it } from 'vitest';
import {
  applyCacheLayers,
  buildGeminiStaticInstructionTexts,
  CACHE_LAYER_WORKSPACE_INDEX,
  isCacheLayeredTopology,
  seedCacheLayeredMessages
} from '@main/orchestrator/context/buildContextLayers';
import { buildOrchestratorRequest } from '@main/orchestrator/loop/buildOrchestratorRequest';
import { buildHostEnvironmentXml } from '@main/orchestrator/loop/buildHostEnvironment';
import { wrapXml } from '@main/orchestrator/envelope';
import { __geminiInternals } from '@main/providers/geminiChatStream';
import { messagesToResponsesInput } from '@main/providers/openaiResponsesStream';
import type { ModelSelection } from '@shared/types/provider';

const FIXED_NOW = new Date('2026-06-09T12:00:00.000Z');

describe('cache-layered topology invariants', () => {
  it('preserves slot roles after applyCacheLayers', () => {
    const messages = seedCacheLayeredMessages(
      [{ role: 'assistant', content: 'prior reply' }],
      '<turn>current</turn>'
    );
    applyCacheLayers(messages, {
      harness: wrapXml('system_instructions', 'harness'),
      env: {
        metaRulesXml: wrapXml('meta_rules', 'rules'),
        workspaceXml: wrapXml('workspace_context', 'ws'),
        sessionXml: wrapXml('session_context', 'sess'),
        priorConversationsXml: wrapXml('prior_conversations', 'prior'),
        memoryXml: wrapXml('recent_memory', 'mem'),
        runProgressXml: ''
      },
      runStateXml: wrapXml('run_state', 'run'),
      hostEnvironmentXml: wrapXml('host_environment', 'host')
    });

    expect(isCacheLayeredTopology(messages)).toBe(true);
    expect(messages[0]?.role).toBe('system');
    expect(messages[CACHE_LAYER_WORKSPACE_INDEX]?.role).toBe('user');
    expect(messages[messages.length - 2]?.role).toBe('user');
    expect(messages[messages.length - 1]?.role).toBe('user');
    expect(messages[messages.length - 3]?.role).toBe('assistant');
  });

  it('keeps host clock out of static system and workspace slots', () => {
    const hostXml = buildHostEnvironmentXml(FIXED_NOW);
    const messages = seedCacheLayeredMessages([], '<turn>t</turn>');
    applyCacheLayers(messages, {
      harness: 'HARNESS',
      env: {
        metaRulesXml: wrapXml('meta_rules', 'rules'),
        workspaceXml: wrapXml('workspace_context', 'ws'),
        sessionXml: '',
        priorConversationsXml: '',
        memoryXml: '',
        runProgressXml: ''
      },
      runStateXml: wrapXml('run_state', 'run'),
      hostEnvironmentXml: hostXml
    });

    expect(messages[0]?.content).not.toContain('now_utc');
    expect(messages[CACHE_LAYER_WORKSPACE_INDEX]?.content).not.toContain('now_utc');
    expect(messages[messages.length - 2]?.content).toContain('now_utc');
  });
});

describe('Gemini wire snapshots', () => {
  it('hoists system and workspace out of contents when cache-layered', async () => {
    const messages = seedCacheLayeredMessages(
      [{ role: 'assistant', content: 'history' }],
      '<turn>tail</turn>'
    );
    applyCacheLayers(messages, {
      harness: 'HARNESS',
      env: {
        metaRulesXml: wrapXml('meta_rules', 'rules'),
        workspaceXml: wrapXml('workspace_context', 'ws-body'),
        sessionXml: '',
        priorConversationsXml: '',
        memoryXml: '',
        runProgressXml: ''
      },
      runStateXml: wrapXml('run_state', 'run'),
      hostEnvironmentXml: wrapXml('host_environment', 'host')
    });

    const staticParts = buildGeminiStaticInstructionTexts(messages);
    expect(staticParts).toHaveLength(2);
    expect(staticParts[0]).toContain('HARNESS');
    expect(staticParts[1]).toContain('workspace_context');

    const geminiWireProvider = {
      id: 'p',
      name: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      dialect: 'gemini-native' as const,
      enabled: true,
      models: [],
      apiKey: 'AIza-test'
    };
    const { contents } = await __geminiInternals.toGeminiContents(messages, geminiWireProvider);
    expect(contents[0]?.parts[0]).toMatchObject({ text: expect.stringContaining('history') });
    expect(contents.some((c) => String(c.parts[0]?.text ?? '').includes('workspace_context'))).toBe(
      false
    );
  });
});

describe('wrap-up synthesis turn', () => {
  const selection: ModelSelection = { providerId: 'p', modelId: 'm' };

  it('preserves cache-layered slot count through wrap-up merge', () => {
    const turn = '<turn>current</turn>';
    const historyAssistant = 'assistant history';
    const messages = seedCacheLayeredMessages(
      [{ role: 'assistant', content: historyAssistant }],
      turn
    );
    applyCacheLayers(messages, {
      harness: 'HARNESS',
      env: {
        metaRulesXml: wrapXml('meta_rules', 'rules'),
        workspaceXml: wrapXml('workspace_context', 'ws'),
        sessionXml: '',
        priorConversationsXml: '',
        memoryXml: '',
        runProgressXml: ''
      },
      runStateXml: wrapXml('run_state', 'run'),
      hostEnvironmentXml: wrapXml('host_environment', 'host')
    });

    const req = buildOrchestratorRequest({
      selection,
      messages,
      signal: new AbortController().signal,
      wrapUp: true
    });

    expect(req.messages).toHaveLength(messages.length);
    expect(isCacheLayeredTopology(req.messages)).toBe(true);
    expect(String(req.messages[req.messages.length - 1]?.content)).toMatch(
      /final turn and tool calling is disabled/i
    );
    expect(String(req.messages[req.messages.length - 1]?.content)).toContain(turn);
    expect(String(req.messages[CACHE_LAYER_WORKSPACE_INDEX]?.content)).toContain('workspace_context');
  });
});

describe('multi-turn prefix growth', () => {
  it('keeps stable slots fixed while history grows across turns', () => {
    const turn1 = '<turn>first</turn>';
    const messages = seedCacheLayeredMessages(
      [{ role: 'assistant', content: 'reply one' }],
      turn1
    );
    const harness = wrapXml('system_instructions', 'harness-static');
    const workspace = wrapXml('workspace_context', 'workspace-static');
    const layers = {
      harness,
      env: {
        metaRulesXml: wrapXml('meta_rules', 'rules'),
        workspaceXml: workspace,
        sessionXml: '',
        priorConversationsXml: '',
        memoryXml: '',
        runProgressXml: ''
      },
      runStateXml: wrapXml('run_state', 'run'),
      hostEnvironmentXml: wrapXml('host_environment', 'host-v1')
    };
    applyCacheLayers(messages, layers);

    const systemBefore = messages[0]?.content;
    const workspaceBefore = messages[CACHE_LAYER_WORKSPACE_INDEX]?.content;
    const historyLenBefore = messages.length;

    messages.splice(
      messages.length - 2,
      0,
      { role: 'assistant', content: 'reply two' },
      { role: 'user', content: '<tool-result>read output</tool-result>' }
    );
    applyCacheLayers(messages, {
      ...layers,
      hostEnvironmentXml: wrapXml('host_environment', 'host-v2')
    });

    expect(messages[0]?.content).toBe(systemBefore);
    expect(messages[CACHE_LAYER_WORKSPACE_INDEX]?.content).toBe(workspaceBefore);
    expect(messages.length).toBe(historyLenBefore + 2);
    expect(isCacheLayeredTopology(messages)).toBe(true);
    expect(String(messages[messages.length - 2]?.content)).toContain('host-v2');
    expect(String(messages[messages.length - 2]?.content)).not.toBe(
      String(messages[messages.length - 3]?.content)
    );
  });
});

describe('OpenAI Responses input order', () => {
  it('preserves cache-layered message order including static slots', () => {
    const messages = seedCacheLayeredMessages(
      [{ role: 'assistant', content: 'hist' }],
      '<turn>end</turn>'
    );
    applyCacheLayers(messages, {
      harness: 'SYS',
      env: {
        metaRulesXml: '',
        workspaceXml: 'WS',
        sessionXml: '',
        priorConversationsXml: '',
        memoryXml: '',
        runProgressXml: ''
      },
      runStateXml: 'RUN',
      hostEnvironmentXml: 'HOST'
    });

    const input = messagesToResponsesInput(messages) as Array<{ role: string; content: string }>;
    expect(input.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'user'
    ]);
    expect(input[0]?.content).toContain('SYS');
    expect(input[1]?.content).toBe('WS');
    expect(input[2]?.content).toBe('hist');
  });
});
