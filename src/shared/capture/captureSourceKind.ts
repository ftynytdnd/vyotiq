export type CaptureSourceKind = 'screen' | 'window';

export function captureSourceKind(id: string): CaptureSourceKind {
  return id.startsWith('screen:') ? 'screen' : 'window';
}
