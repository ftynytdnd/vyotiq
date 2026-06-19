import { guessMimeFromName } from '@shared/attachments/mediaKind.js';

/** Collect unique `File` entries from a paste/drag clipboard. */
export function collectClipboardFiles(data: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null) => {
    if (!file) return;
    const key = `${file.name}\0${file.size}\0${file.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };

  for (const file of Array.from(data.files)) {
    push(file);
  }
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file') {
      push(item.getAsFile());
    }
  }
  return out;
}

export function clipboardHasImagePayload(data: DataTransfer): boolean {
  const files = collectClipboardFiles(data);
  return (
    Array.from(data.items).some((item) => item.type.startsWith('image/')) ||
    files.some((file) => file.type.startsWith('image/'))
  );
}

export async function readClipboardFileBlobs(
  data: DataTransfer
): Promise<Array<{ name: string; mimeType: string; data: ArrayBuffer }>> {
  const files = collectClipboardFiles(data);
  const out: Array<{ name: string; mimeType: string; data: ArrayBuffer }> = [];
  for (const file of files) {
    if (file.size === 0 && !file.type) continue;
    const name = file.name?.trim() || `pasted-${Date.now()}`;
    const mimeType = file.type || guessMimeFromName(name);
    out.push({
      name,
      mimeType,
      data: await file.arrayBuffer()
    });
  }
  return out;
}
