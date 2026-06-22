import { describe, expect, it } from 'vitest';
import {
  applyCacheLayers,
  buildGeminiStaticInstructionTexts,
  buildRuntimeTailXml,
  buildStaticSystemPrefix,
  CACHE_LAYER_WORKSPACE_INDEX,
  isCacheLayeredTopology,
  insertHistoryBeforeTail,
  migrateToCacheLayeredInPlace,
  seedCacheLayeredMessages
} from '@main/orchestrator/context/buildContextLayers';
import { wrapXml } from '@main/orchestrator/envelope';

describe('buildContextLayers', () => {
  it('seeds cache-layered topology with workspace slot at index 1', () => {
    const messages = seedCacheLayeredMessages(
      [{ role: 'user', content: '<turn>hi</turn>' }],
      '<turn>current</turn>'
    );
    expect(isCacheLayeredTopology(messages)).toBe(true);
    expect(messages[0]?.role).toBe('system');
    expect(messages[CACHE_LAYER_WORKSPACE_INDEX]?.role).toBe('user');
    expect(messages[messages.length - 1]?.content).toBe('<turn>current</turn>');
  });

  it('recognizes the minimal 4-slot cache-layered layout', () => {
    const messages = [
      { role: 'system' as const, content: 'harness' },
      { role: 'user' as const, content: wrapXml('workspace_context', 'ws') },
      { role: 'user' as const, content: wrapXml('runtime_context', 'run') },
      { role: 'user' as const, content: '<turn>current</turn>' }
    ];
    expect(isCacheLayeredTopology(messages)).toBe(true);
    applyCacheLayers(messages, {
      harness: 'HARNESS',
      env: {
        metaRulesXml: '',
        workspaceXml: wrapXml('workspace_context', 'ws-new'),
        sessionXml: '',
        priorConversationsXml: '',
        memoryXml: '',
        runProgressXml: ''
      },
      runStateXml: wrapXml('run_state', 'run'),
      hostEnvironmentXml: wrapXml('host_environment', 'host')
    });
    expect(messages[CACHE_LAYER_WORKSPACE_INDEX]?.content).toContain('ws-new');
  });

  it('migrates minimal legacy system + turn layout in place', () => {
    const messages = [
      { role: 'system' as const, content: 'legacy system' },
      { role: 'user' as const, content: '<turn>only</turn>' }
    ];
    migrateToCacheLayeredInPlace(messages);
    expect(isCacheLayeredTopology(messages)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(4);
  });

  it('migrates legacy single-system layout in place', () => {
    const messages = [
      { role: 'system' as const, content: 'legacy system' },
      { role: 'user' as const, content: '<turn>old</turn>' },
      { role: 'assistant' as const, content: 'ok' },
      { role: 'user' as const, content: '<turn>new</turn>' }
    ];
    migrateToCacheLayeredInPlace(messages);
    expect(isCacheLayeredTopology(messages)).toBe(true);
    // [system, workspace, <turn>old</turn>, ok, runtime, <turn>new</turn>]
    expect(messages[3]?.content).toBe('ok');
    expect(messages[messages.length - 1]?.content).toBe('<turn>new</turn>');
  });

  it('applyCacheLayers writes static, workspace, and runtime slots — no few-shot', () => {
    const messages = seedCacheLayeredMessages([], '<turn>t</turn>');
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
    expect(messages[0]?.content).toContain('harness');
    expect(messages[0]?.content).toContain('meta_rules');
    expect(messages[0]?.content).not.toContain('static_examples');
    expect(messages[CACHE_LAYER_WORKSPACE_INDEX]?.content).toContain('workspace_context');
    const runtime = messages[messages.length - 2]?.content ?? '';
    expect(runtime).toContain('runtime_context');
    expect(runtime).toContain('host_environment');
    expect(runtime).not.toContain('workspace_context');
  });

  it('buildStaticSystemPrefix joins harness and meta rules only', () => {
    const out = buildStaticSystemPrefix('HARNESS', wrapXml('meta_rules', 'x'));
    expect(out).toContain('HARNESS');
    expect(out).toContain('meta_rules');
  });

  it('buildGeminiStaticInstructionTexts returns system, then workspace', () => {
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
      runStateXml: '',
      hostEnvironmentXml: ''
    });
    const parts = buildGeminiStaticInstructionTexts(messages);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('HARNESS');
    expect(parts[1]).toContain('workspace_context');
  });

  it('insertHistoryBeforeTail keeps runtime and turn at the tail after tool rounds', () => {
    const messages = seedCacheLayeredMessages(
      [{ role: 'user', content: '<turn>hist</turn>' }],
      '<turn>current</turn>'
    );
    applyCacheLayers(messages, {
      harness: 'HARNESS',
      env: {
        metaRulesXml: '',
        workspaceXml: wrapXml('workspace_context', 'ws-v1'),
        sessionXml: '',
        priorConversationsXml: '',
        memoryXml: '',
        runProgressXml: ''
      },
      runStateXml: wrapXml('run_state', 'iter-0'),
      hostEnvironmentXml: wrapXml('host_environment', 'host-v1')
    });
    insertHistoryBeforeTail(messages, {
      role: 'assistant',
      content: 'working',
      tool_calls: [
        {
          id: 'tc-1',
          type: 'function',
          function: { name: 'read', arguments: '{"path":"a.ts"}' }
        }
      ]
    });
    insertHistoryBeforeTail(messages, {
      role: 'tool',
      tool_call_id: 'tc-1',
      name: 'read',
      content: 'file body'
    });
    expect(isCacheLayeredTopology(messages)).toBe(true);
    applyCacheLayers(messages, {
      harness: 'HARNESS',
      env: {
        metaRulesXml: '',
        workspaceXml: wrapXml('workspace_context', 'ws-v2'),
        sessionXml: '',
        priorConversationsXml: '',
        memoryXml: '',
        runProgressXml: ''
      },
      runStateXml: wrapXml('run_state', 'iter-1'),
      hostEnvironmentXml: wrapXml('host_environment', 'host-v2')
    });
    const runtime = messages[messages.length - 2]?.content ?? '';
    expect(runtime).toContain('iter-1');
    expect(runtime).toContain('host-v2');
    expect(messages[messages.length - 1]?.content).toBe('<turn>current</turn>');
  });

  it('buildRuntimeTailXml wraps volatile envelopes', () => {
    const out = buildRuntimeTailXml(
      wrapXml('host_environment', 't'),
      wrapXml('run_state', 'r'),
      {
        sessionXml: wrapXml('session_context', 's'),
        priorConversationsXml: wrapXml('prior_conversations', 'p'),
        memoryXml: wrapXml('recent_memory', 'm'),
        runProgressXml: ''
      }
    );
    expect(out).toContain('<runtime_context>');
    expect(out).toContain('host_environment');
  });
});
