/**
 * OpenAI dialect transport selection (2026).
 *
 * Official OpenAI reasoning models are recommended on the Responses API;
 * third-party OpenAI-compatible gateways stay on Chat Completions unless
 * the user pins `openaiTransport: 'responses'`.
 */

import type { ModelThinkingCapabilities, OpenAiTransport, ProviderConfig } from '../types/provider.js';
import { findProviderModel } from './modelId.js';

function isOfficialOpenAiHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

function autoPreferResponses(
  baseUrl: string,
  caps?: ModelThinkingCapabilities
): boolean {
  if (!isOfficialOpenAiHost(baseUrl)) return false;
  if (caps?.wireStyle !== 'openai-reasoning' || !caps.supported) return false;
  return true;
}

/**
 * Resolved wire transport for an OpenAI-dialect chat request.
 */
export function resolveOpenAiTransport(
  provider: Pick<ProviderConfig, 'baseUrl' | 'openaiTransport' | 'models'>,
  modelId: string
): Exclude<OpenAiTransport, 'auto'> {
  const mode = provider.openaiTransport ?? 'auto';
  if (mode === 'chat-completions') return 'chat-completions';
  if (mode === 'responses') return 'responses';
  const caps = findProviderModel(provider, modelId)?.thinking;
  return autoPreferResponses(provider.baseUrl, caps) ? 'responses' : 'chat-completions';
}

/** Whether a failed Responses request should retry on Chat Completions. */
export function shouldFallbackResponsesToChatCompletions(
  status: number,
  lockedToResponses: boolean
): boolean {
  if (lockedToResponses) return false;
  return status === 404 || status === 400 || status === 422;
}
