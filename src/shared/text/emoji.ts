/**
 * Small display sanitizer for UI surfaces that render model-authored prose.
 *
 * The app intentionally avoids emoji in its interface. Model output can still
 * include emoji in markdown headings or prose, so renderers call `stripEmoji`
 * at the display boundary. This does not mutate transcripts or tool payloads.
 */

const EMOJI_RE =
  /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*)/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ');
}
