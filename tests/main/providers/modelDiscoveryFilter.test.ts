/**
 * Unit tests for `isNonChatModel` — the pattern-based filter that prevents
 * non-chat model IDs (embeddings, moderation, OCR, rerank, TTS, STT, image
 * generation) from appearing in the model picker.
 *
 * Each test section covers one category of non-chat surface plus a set of
 * chat-capable models that must NOT be filtered so we can verify the patterns
 * are conservative (no false positives on legitimate chat models).
 */

import { describe, expect, it } from 'vitest';
import { isNonChatModel } from '@main/providers/modelDiscovery';

describe('isNonChatModel', () => {
  // ── Embeddings ──────────────────────────────────────────────────────────────

  it('filters text-embedding-* (OpenAI canonical)', () => {
    expect(isNonChatModel('text-embedding-3-small')).toBe(true);
    expect(isNonChatModel('text-embedding-3-large')).toBe(true);
    expect(isNonChatModel('text-embedding-ada-002')).toBe(true);
  });

  it('filters *-embed (Mistral, Cohere)', () => {
    expect(isNonChatModel('mistral-embed')).toBe(true);
    expect(isNonChatModel('codestral-embed')).toBe(true);
  });

  it('filters *-embeddings (plural form)', () => {
    expect(isNonChatModel('nomic-embed-text-v1-5')).toBe(true);
    expect(isNonChatModel('mxbai-embed-large-v1')).toBe(true);
  });

  it('filters OpenRouter-prefixed embedding routes', () => {
    expect(isNonChatModel('openai/text-embedding-3-small')).toBe(true);
    expect(isNonChatModel('cohere/embed-multilingual-v3.0')).toBe(true);
  });

  // ── Moderation ──────────────────────────────────────────────────────────────

  it('filters text-moderation-* (OpenAI)', () => {
    expect(isNonChatModel('text-moderation-latest')).toBe(true);
    expect(isNonChatModel('text-moderation-stable')).toBe(true);
  });

  it('filters mistral-moderation-* (Mistral)', () => {
    expect(isNonChatModel('mistral-moderation-latest')).toBe(true);
    expect(isNonChatModel('mistral-moderation-2411')).toBe(true);
  });

  // ── OCR ─────────────────────────────────────────────────────────────────────

  it('filters *-ocr-* and *-ocr (Mistral OCR surface)', () => {
    expect(isNonChatModel('mistral-ocr-latest')).toBe(true);
    expect(isNonChatModel('pixtral-ocr-2503')).toBe(true);
  });

  // ── Rerank ──────────────────────────────────────────────────────────────────

  it('filters *-rerank-* (Mistral, Cohere)', () => {
    expect(isNonChatModel('mistral-rerank-latest')).toBe(true);
    expect(isNonChatModel('cohere-rerank-english-v3.0')).toBe(true);
    expect(isNonChatModel('rerank-2')).toBe(true);
  });

  // ── TTS ─────────────────────────────────────────────────────────────────────

  it('filters tts-* (OpenAI TTS)', () => {
    expect(isNonChatModel('tts-1')).toBe(true);
    expect(isNonChatModel('tts-1-hd')).toBe(true);
  });

  it('filters OpenRouter-prefixed TTS routes', () => {
    expect(isNonChatModel('openai/tts-1')).toBe(true);
  });

  // ── STT / Whisper ────────────────────────────────────────────────────────────

  it('filters whisper-* (OpenAI ASR)', () => {
    expect(isNonChatModel('whisper-1')).toBe(true);
    expect(isNonChatModel('whisper-large-v3')).toBe(true);
    expect(isNonChatModel('faster-whisper-large-v3')).toBe(true);
  });

  // ── Image generation ────────────────────────────────────────────────────────

  it('filters dall-e-* (OpenAI image gen)', () => {
    expect(isNonChatModel('dall-e-2')).toBe(true);
    expect(isNonChatModel('dall-e-3')).toBe(true);
  });

  it('filters dalle-* (no-hyphen variant)', () => {
    expect(isNonChatModel('dalle-3')).toBe(true);
  });

  it('filters text-to-image and image-generation routes', () => {
    expect(isNonChatModel('stable-diffusion-xl-text-to-image')).toBe(true);
    expect(isNonChatModel('black-forest-labs/flux-1-1-pro-image-generation')).toBe(true);
  });

  // ── Transcription ────────────────────────────────────────────────────────────

  it('filters transcription endpoints', () => {
    expect(isNonChatModel('transcribe-mini')).toBe(true);
    expect(isNonChatModel('gpt-4o-transcribe')).toBe(true);
    expect(isNonChatModel('whisper-transcript-v2')).toBe(true);
  });

  // ── False-positive guard — chat/vision models must NOT be filtered ───────────

  it('does NOT filter GPT-4 chat models', () => {
    expect(isNonChatModel('gpt-4o')).toBe(false);
    expect(isNonChatModel('gpt-4o-mini')).toBe(false);
    expect(isNonChatModel('gpt-4-turbo')).toBe(false);
    expect(isNonChatModel('gpt-3.5-turbo')).toBe(false);
  });

  it('does NOT filter GPT-4 vision-preview (vision is chat-capable)', () => {
    expect(isNonChatModel('gpt-4-vision-preview')).toBe(false);
  });

  it('does NOT filter Mistral chat models', () => {
    expect(isNonChatModel('mistral-large-latest')).toBe(false);
    expect(isNonChatModel('mistral-small-latest')).toBe(false);
    expect(isNonChatModel('mistral-nemo')).toBe(false);
    expect(isNonChatModel('codestral-latest')).toBe(false);
  });

  it('does NOT filter Mistral vision/multimodal chat models', () => {
    expect(isNonChatModel('pixtral-12b-2409')).toBe(false);
    expect(isNonChatModel('pixtral-large-latest')).toBe(false);
  });

  it('does NOT filter Claude chat models', () => {
    expect(isNonChatModel('claude-3-5-sonnet-20241022')).toBe(false);
    expect(isNonChatModel('claude-3-opus-20240229')).toBe(false);
    expect(isNonChatModel('claude-opus-4-5')).toBe(false);
  });

  it('does NOT filter DeepSeek chat models', () => {
    expect(isNonChatModel('deepseek-chat')).toBe(false);
    expect(isNonChatModel('deepseek-v4-flash')).toBe(false);
    expect(isNonChatModel('deepseek-r1')).toBe(false);
  });

  it('does NOT filter Llama vision-instruct chat models', () => {
    expect(isNonChatModel('llama-3.2-11b-vision-instruct')).toBe(false);
    expect(isNonChatModel('meta-llama/llama-3.2-90b-vision-instruct')).toBe(false);
  });

  it('does NOT filter Gemini chat models', () => {
    expect(isNonChatModel('gemini-2.0-flash')).toBe(false);
    expect(isNonChatModel('gemini-1.5-pro')).toBe(false);
  });

  it('does NOT filter Qwen / Mixtral / misc chat models', () => {
    expect(isNonChatModel('qwen2.5-72b-instruct')).toBe(false);
    expect(isNonChatModel('mixtral-8x22b-instruct')).toBe(false);
    expect(isNonChatModel('command-r-plus')).toBe(false);
  });

  // ── OpenRouter prefix stripping ─────────────────────────────────────────────

  it('strips provider prefix before matching for chat models too', () => {
    expect(isNonChatModel('mistral/mistral-large-latest')).toBe(false);
    expect(isNonChatModel('openai/gpt-4o')).toBe(false);
    expect(isNonChatModel('anthropic/claude-3-5-sonnet')).toBe(false);
  });
});
