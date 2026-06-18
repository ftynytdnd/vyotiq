/**
 * Upload preprocessed media bytes to provider Files APIs.
 */

import { createHash } from 'node:crypto';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { logger } from '../../logging/logger.js';
import { getStoredProviderFile, putStoredProviderFile } from './providerFileStore.js';

const log = logger.child('providers/files');

export interface UploadedProviderFile {
  fileId: string;
  mime: string;
  contentHash: string;
}

function hashBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function uploadOpenAiFile(
  provider: ProviderWithKey,
  buffer: Buffer,
  mime: string,
  filename: string
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([bufferToArrayBuffer(buffer)], { type: mime });
  form.append('file', blob, filename);
  form.append('purpose', 'user_data');
  const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/v1/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: form
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI file upload failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('OpenAI file upload returned no id');
  return json.id;
}

async function uploadAnthropicFile(
  provider: ProviderWithKey,
  buffer: Buffer,
  mime: string,
  filename: string
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([bufferToArrayBuffer(buffer)], { type: mime });
  form.append('file', blob, filename);
  const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/v1/files`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'files-api-2025-04-14'
    },
    body: form
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic file upload failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('Anthropic file upload returned no id');
  return json.id;
}

async function uploadGeminiFile(
  provider: ProviderWithKey,
  buffer: Buffer,
  mime: string,
  filename: string
): Promise<{ fileId: string; expiresAt: number }> {
  const base = provider.baseUrl.replace(/\/$/, '');
  const startRes = await fetch(
    `${base}/upload/v1beta/files?key=${encodeURIComponent(provider.apiKey ?? '')}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buffer.length),
        'X-Goog-Upload-Header-Content-Type': mime,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: filename } })
    }
  );
  if (!startRes.ok) {
    const body = await startRes.text().catch(() => '');
    throw new Error(`Gemini file upload start failed (${startRes.status}): ${body.slice(0, 200)}`);
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini upload missing x-goog-upload-url');
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': mime
    },
    body: new Uint8Array(buffer)
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '');
    throw new Error(`Gemini file upload failed (${uploadRes.status}): ${body.slice(0, 200)}`);
  }
  const json = (await uploadRes.json()) as { file?: { uri?: string; name?: string } };
  const uri = json.file?.uri ?? json.file?.name;
  if (!uri) throw new Error('Gemini file upload returned no uri');
  const expiresAt = Date.now() + 48 * 60 * 60 * 1000;
  return { fileId: uri, expiresAt };
}

export function providerSupportsFilesApi(provider: ProviderWithKey): boolean {
  const dialect = provider.dialect ?? 'openai';
  return dialect === 'openai' || dialect === 'anthropic-native' || dialect === 'gemini-native';
}

export async function ensureProviderFileUploaded(
  provider: ProviderWithKey,
  buffer: Buffer,
  mime: string,
  filename: string
): Promise<UploadedProviderFile | null> {
  if (!providerSupportsFilesApi(provider)) return null;
  const contentHash = hashBytes(buffer);
  const cached = await getStoredProviderFile(provider.id, contentHash);
  if (cached) {
    return { fileId: cached.fileId, mime: cached.mime, contentHash };
  }
  try {
    const dialect = provider.dialect ?? 'openai';
    let fileId: string;
    let expiresAt: number | undefined;
    if (dialect === 'anthropic-native') {
      fileId = await uploadAnthropicFile(provider, buffer, mime, filename);
    } else if (dialect === 'gemini-native') {
      const gem = await uploadGeminiFile(provider, buffer, mime, filename);
      fileId = gem.fileId;
      expiresAt = gem.expiresAt;
    } else {
      fileId = await uploadOpenAiFile(provider, buffer, mime, filename);
    }
    await putStoredProviderFile({
      providerId: provider.id,
      contentHash,
      fileId,
      mime,
      uploadedAt: Date.now(),
      expiresAt
    });
    return { fileId, mime, contentHash };
  } catch (err: unknown) {
    log.warn('provider file upload failed; falling back to base64', {
      providerId: provider.id,
      err
    });
    return null;
  }
}
