// U+02BB (ʻ in oʻ, gʻ) and U+02BC (ʼ) are spacing modifier letters, so a plain split would separate them from their
// letter. Keep them, and combining marks, with the letter before.
const ATTACH = /[ʻʼ̀-ͯ]/;

/** Split text into letters for per-letter animation without breaking Uzbek oʻ, gʻ or ʼ. */
export const graphemes = (text: string): string[] => {
  const out: string[] = [];
  for (const ch of Array.from(text)) {
    if (out.length && ATTACH.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
};
