/**
 * Parse context-window limits from NVIDIA NGC model-card markdown.
 * Patterns adapted from the public build.nvidia.com catalog (2026).
 */

const SEP = '[*\\s:=]*';

const CONTEXT_PATTERNS: RegExp[] = [
  new RegExp(`Input\\s+Context\\s+Length\\s*\\(ISL\\)${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm]?)\\b`, 'i'),
  new RegExp(`Context\\s+(?:Length|Window|Size)${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm]?)\\s+tokens?\\b`, 'i'),
  new RegExp(`Context\\s+(?:Length|Window|Size)\\s+up\\s+to${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm]?)\\s+tokens?\\b`, 'i'),
  new RegExp(`Context\\s+(?:Length|Window|Size)\\s+up\\s+to${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm])\\b`, 'i'),
  new RegExp(`Up\\s+to${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm]?)\\s+tokens?\\s+context\\s+(?:length|window|size)`, 'i'),
  new RegExp(`Input\\s*\\+\\s*Output\\s+Tokens?${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm])\\b`, 'i'),
  /Maximum\s+context\s+length\s+(?:is|of)\s+(\d+(?:\.\d+)?)\s+million\b/i,
  /Maximum\s+context\s+length\s+(?:is|of)\s+(\d+(?:\.\d+)?)\s+billion\b/i,
  /Maximum\s+context\s+length\s+(?:is|of)\s+([0-9.,]+\s*(?:[KkMm]|million|billion)?)/i,
  new RegExp(`Input\\s+context\\s+length${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm]?)\\s+tokens?\\b`, 'i'),
  new RegExp(`Input\\s+context\\s+length${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm])\\b`, 'i'),
  new RegExp(`Total\\s+input\\s+context\\s+(?:of\\s+)?${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm])\\s+tokens?\\b`, 'i'),
  new RegExp(`Max(?:imum)?\\s+input\\s+(?:length|context|tokens?)${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm]?)\\s+tokens?\\b`, 'i'),
  new RegExp(
    `(?:natively\\s+)?supports?\\s+context\\s+lengths?\\s+of\\s+up\\s+to${SEP}([0-9,]+(?:\\.\\d+)?\\s*[KkMm]?)\\s+tokens?\\b`,
    'i'
  ),
  /(?:Long[- ]context\s+support\s+up\s+to|context\s+support\s+up\s+to)\s+([0-9.,]+\s*[KkMm]?)\s+tokens?\b/i,
  /context\s+length\s+of\s+up\s+to\s+(\d+(?:\.\d+)?\s*[KkMm])/i,
  /supports?\s+up\s+to\s+(\d+(?:\.\d+)?\s*[KkMm])\s+(?:tokens?\s+(?:of\s+)?context|context)/i,
  /maximum\s+of\s+([0-9,]+)\s+input\s+tokens?\b/i,
  /\b(\d+(?:\.\d+)?\s*[KkMm])\s+(?:Maximum\s+)?[Cc]ontext\s+(?:Length|Window|Size)\b/,
  /\b[Mm]aximum\s+[Cc]ontext\s+[Ll]ength\s+(\d+(?:\.\d+)?\s*[KkMm])\b/,
  /\b(\d+(?:\.\d+)?\s*[KkMm])[- ]token\s+context\b/i,
  /\b(\d+(?:\.\d+)?\s*[KkMm])\s+context\s+(?:length|window|size)\b/i,
  /\b(\d+(?:\.\d+)?\s*[KkMm])-token\s+context\s+window\b/i
];

const MIN_PLAUSIBLE_CONTEXT = 512;
const MAX_PLAUSIBLE_CONTEXT = 100 * 1024 * 1024;

export function parseNvidiaTokenCount(rawValue: unknown): number | undefined {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0) {
    return Math.round(rawValue);
  }
  if (typeof rawValue !== 'string') return undefined;
  const compact = rawValue.trim().replace(/,/g, '').replace(/\s+/g, '');
  if (!compact) return undefined;
  const m = compact.match(/^(\d+(?:\.\d+)?)([kmgb])?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const suf = (m[2] ?? '').toLowerCase();
  if (suf === 'k') return Math.round(n * 1024);
  if (suf === 'm') return Math.round(n * 1024 * 1024);
  if (suf === 'g' || suf === 'b') return Math.round(n * 1024 * 1024 * 1024);
  return Math.round(n);
}

function isPlausibleContext(value: number): boolean {
  return value >= MIN_PLAUSIBLE_CONTEXT && value <= MAX_PLAUSIBLE_CONTEXT;
}

function extractContextLengthFromMarkdownTable(text: string): number | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i]!;
    if (!line.includes('|')) continue;

    if (/Context\s+(?:Length|Window|Size)/i.test(line)) {
      const same = line.match(/Context\s+(?:Length|Window|Size)[^|]*\|[^|]*?(\d+(?:\.\d+)?\s*[KkMm]?)/i);
      if (same) {
        const v = parseNvidiaTokenCount(same[1]);
        if (v !== undefined && isPlausibleContext(v)) return v;
      }
    }

    if (/Context\s+(?:Length|Window|Size)/i.test(line) && i + 1 < lines.length) {
      let dataIdx = -1;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j += 1) {
        if (lines[j]!.includes('|') && !/^[\s|:\-]+$/.test(lines[j]!)) {
          dataIdx = j;
          break;
        }
      }
      if (dataIdx === -1) continue;
      const headerCells = line.split('|').map((c) => c.trim());
      const dataCells = lines[dataIdx]!.split('|').map((c) => c.trim());
      for (let ci = 0; ci < headerCells.length; ci += 1) {
        if (/Context\s+(?:Length|Window|Size)/i.test(headerCells[ci]!) && ci < dataCells.length) {
          const cell = dataCells[ci]!;
          const m = cell.match(/(\d+(?:\.\d+)?\s*[KkMm]?)\b/);
          if (m) {
            const v = parseNvidiaTokenCount(m[1]);
            if (v !== undefined && isPlausibleContext(v)) return v;
          }
        }
      }
    }
  }
  return undefined;
}

/** Extract input context length (tokens) from an NGC model-card markdown body. */
export function parseNvidiaContextLength(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  for (const pattern of CONTEXT_PATTERNS) {
    const m = text.match(pattern);
    if (!m?.[1]) continue;
    const raw = m[1].trim();
    const matched = m[0];
    if (/million\b/i.test(matched)) {
      const num = parseFloat(raw);
      if (Number.isFinite(num)) {
        const v = Math.round(num * 1_000_000);
        if (isPlausibleContext(v)) return v;
      }
    }
    if (/billion\b/i.test(matched)) {
      const num = parseFloat(raw);
      if (Number.isFinite(num)) {
        const v = Math.round(num * 1_000_000_000);
        if (isPlausibleContext(v)) return v;
      }
    }
    const v = parseNvidiaTokenCount(raw);
    if (v !== undefined && isPlausibleContext(v)) return v;
  }
  const tableValue = extractContextLengthFromMarkdownTable(text);
  return tableValue !== undefined && isPlausibleContext(tableValue) ? tableValue : undefined;
}
