/**
 * Build a DataTransfer from navigator.clipboard (keydown Mod+V fallback).
 */

export async function buildClipboardDataTransfer(): Promise<DataTransfer | null> {
  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    let plainText = '';
    let htmlText = '';

    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (type === 'text/plain') {
          plainText = await blob.text();
        } else if (type === 'text/html') {
          htmlText = await blob.text();
        } else if (type.startsWith('image/') || type === 'application/pdf') {
          const ext = type.split('/')[1] ?? 'bin';
          files.push(new File([blob], `clipboard.${ext}`, { type }));
        }
      }
    }

    const dt = new DataTransfer();
    for (const file of files) {
      dt.items.add(file);
    }

    return Object.assign(dt, {
      getData: (format: string) => {
        if (format === 'text/plain') return plainText;
        if (format === 'text/html') return htmlText;
        return '';
      }
    }) as DataTransfer;
  } catch {
    try {
      const plainText = await navigator.clipboard.readText();
      if (!plainText) return null;
      const dt = new DataTransfer();
      return Object.assign(dt, {
        getData: (format: string) => (format === 'text/plain' ? plainText : '')
      }) as DataTransfer;
    } catch {
      return null;
    }
  }
}
