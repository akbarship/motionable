// Turning what the user typed into a folder name.
/** A style's folder name from what the user typed, in any script (Uzbek, Russian, English). */
export const slug = (s: string) => {
  const map: Record<string, string> = {а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
    о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ы: 'i', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h'};
  const out = s.trim().toLowerCase().split('').map((c) => map[c] ?? c).join('').replace(/[ʻʼ'`’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return out.slice(0, 40);
};
