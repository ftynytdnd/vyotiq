/**
 * @deprecated Legacy single-system composer. Production uses cache-layered
 * topology via `buildContextLayers.ts`. Kept for tests and backward-compat
 * replay of pre-migration transcripts.
 */

import type { ContextEnvelopes } from '../contextManager.js';
import {
  buildRuntimeTailXml,
  buildStaticSystemPrefix
} from '../context/buildContextLayers.js';

export function buildSystemPrompt(
  harness: string,
  env: ContextEnvelopes,
  runStateXml: string,
  hostEnvironmentXml: string
): string {
  return [
    buildStaticSystemPrefix(harness, env.metaRulesXml),
    env.workspaceXml,
    buildRuntimeTailXml(hostEnvironmentXml, runStateXml, env)
  ].join('\n\n');
}
