/**
 * Vision / multimodal input capability helpers (2026).
 *
 * Discovery populates `ModelInfo.inputModalities`; this module resolves
 * UI gates and orchestrator send paths from that metadata.
 */

import type { ModelInputModality, ModelInfo } from '../types/provider.js';

const MODALITY_ORDER: readonly ModelInputModality[] = [
  'text',
  'image',
  'file',
  'video',
  'audio'
];

/** Normalize upstream modality strings into our union. */
export function normalizeInputModalities(raw: unknown): ModelInputModality[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const set = new Set<ModelInputModality>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const key = item.toLowerCase().trim();
    if (key === 'text') set.add('text');
    else if (key === 'image' || key === 'images') set.add('image');
    else if (key === 'file' || key === 'pdf' || key === 'document') set.add('file');
    else if (key === 'video' || key === 'videos') set.add('video');
    else if (key === 'audio') set.add('audio');
  }
  if (set.size === 0) return undefined;
  if (!set.has('text')) set.add('text');
  return MODALITY_ORDER.filter((m) => set.has(m));
}

export function orderedInputModalities(
  modalities: Iterable<ModelInputModality>
): ModelInputModality[] {
  const set = new Set(modalities);
  return MODALITY_ORDER.filter((m) => set.has(m));
}

export function mergeInputModalities(
  ...candidates: Array<ModelInputModality[] | undefined>
): ModelInputModality[] | undefined {
  const set = new Set<ModelInputModality>();
  for (const c of candidates) {
    if (!c) continue;
    for (const m of c) set.add(m);
  }
  if (set.size === 0) return undefined;
  return orderedInputModalities(set);
}

/**
 * Prefer discovery/API modality lists; fall back to model-id heuristics only
 * when every API source is absent.
 */
export function resolveInputModalitiesFromDiscovery(
  modelId: string,
  ...apiSources: Array<ModelInputModality[] | undefined>
): Pick<ModelInfo, 'inputModalities' | 'inputModalitiesEstimated'> {
  const fromApi = mergeInputModalities(...apiSources);
  if (fromApi) {
    return { inputModalities: fromApi };
  }
  const fallback = inputModalitiesFromModelId(modelId);
  if (!fallback) return {};
  return { inputModalities: fallback, inputModalitiesEstimated: true };
}

export function modelSupportsVision(
  modalities: ModelInputModality[] | undefined
): boolean {
  return modalities?.includes('image') === true;
}

export function modelSupportsPdfNative(
  modalities: ModelInputModality[] | undefined
): boolean {
  return modalities?.includes('file') === true;
}

export function modelSupportsVideoNative(
  modalities: ModelInputModality[] | undefined
): boolean {
  return modalities?.includes('video') === true;
}

export function modelSupportsAudioNative(
  modalities: ModelInputModality[] | undefined
): boolean {
  return modalities?.includes('audio') === true;
}

/** Heuristic for models that can emit image output (Gemini image, OpenAI image gen). */
export function modelSupportsImageOutput(
  modelId: string,
  discovery?: { id?: string; label?: string }
): boolean {
  const discoveryId = (discovery?.id ?? discovery?.label ?? '').toLowerCase();
  if (discoveryId.length > 0) {
    if (/imagen|flash-image|gemini-.*-image|image-preview|image-generation/.test(discoveryId)) {
      return true;
    }
    if (/^gemini-[\d.]+\-(pro|flash)(-preview)?$/i.test(discoveryId)) {
      return false;
    }
  }
  const id = modelId.toLowerCase();
  const tail = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  const patterns = [
    /imagen/,
    /flash-image/,
    /gemini-.*-image/,
    /gpt-image/,
    /dall-?e/,
    /image-preview/,
    /image-generation/
  ];
  return patterns.some((re) => re.test(tail) || re.test(id));
}

/** OpenRouter `architecture.input_modalities` on `/v1/models` rows. */
export function inputModalitiesFromOpenRouterArchitecture(
  architecture: unknown
): ModelInputModality[] | undefined {
  if (!architecture || typeof architecture !== 'object') return undefined;
  const raw = (architecture as { input_modalities?: unknown }).input_modalities;
  return normalizeInputModalities(raw);
}

/** Conservative id heuristics when discovery omits modality metadata. */
export function inputModalitiesFromModelId(modelId: string): ModelInputModality[] | undefined {
  const id = modelId.toLowerCase();
  const tail = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;

  const visionPatterns = [
    /vision/,
    /llava/,
    /bakllava/,
    /pixtral/,
    /gemma-?3/,
    /gemma4/,
    /gpt-4o/,
    /gpt-4\.1/,
    /gpt-5/,
    /claude-.*-(sonnet|opus|haiku)/,
    /gemini-.*-(pro|flash|ultra)/,
    /qwen.*vl/,
    /internvl/,
    /molmo/,
    /phi-.*-vision/
  ];
  const hasVision = visionPatterns.some((re) => re.test(tail) || re.test(id));
  if (!hasVision) return undefined;

  const modalities: ModelInputModality[] = ['text', 'image'];
  if (/gemini|claude|gpt-4o|gpt-5|gpt-4\.1/i.test(tail) || /gemini|claude/i.test(id)) {
    modalities.push('file');
  }
  if (/gemini/i.test(tail) || /gemini/i.test(id)) {
    modalities.push('video', 'audio');
  }
  if (/gpt-audio/i.test(tail) || /gpt-audio/i.test(id)) {
    return orderedInputModalities(['text', 'image', 'audio']);
  }
  return orderedInputModalities(modalities);
}

/** Anthropic model list — vision-capable Claude models accept images + PDF. */
export function inputModalitiesFromAnthropicModel(model: {
  id?: string;
  capabilities?: unknown;
}): ModelInputModality[] | undefined {
  const caps = model.capabilities;
  if (caps && typeof caps === 'object') {
    const vision = (caps as { vision?: { supported?: boolean } }).vision;
    if (vision?.supported === true) {
      return ['text', 'image', 'file'];
    }
  }
  return undefined;
}

/** Gemini models with `generateContent` generally support vision input. */
export function inputModalitiesFromGeminiModel(model: {
  name?: string;
  supportedGenerationMethods?: string[];
}): ModelInputModality[] | undefined {
  const methods = model.supportedGenerationMethods;
  if (!Array.isArray(methods) || !methods.includes('generateContent')) return undefined;
  const id = (model.name ?? '').replace(/^models\//, '').toLowerCase();
  if (id.includes('embedding') || id.includes('aqa') || id.includes('tts')) return undefined;
  return ['text', 'image', 'file', 'video', 'audio'];
}

/** Ollama `/api/show` capabilities + model id. */
export function inputModalitiesFromOllamaShow(show: {
  capabilities?: string[];
  model?: string;
}): ModelInputModality[] | undefined {
  const caps = show.capabilities;
  if (Array.isArray(caps) && caps.includes('vision')) {
    return ['text', 'image'];
  }
  const id = show.model ?? '';
  return inputModalitiesFromModelId(id);
}
