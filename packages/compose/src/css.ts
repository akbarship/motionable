// A component's CSS, read at build time: the HyperFrames compiler finds fonts in the page's static CSS, so CSS that
// a script adds at run time would render in a fallback font. The script runs in an empty sandbox with a stub MC.
import vm from 'node:vm';

export const componentCss = (source: string, ref: string): string => {
  let css = '';
  const MC = {define: (r: string, def: {css?: string}) => { if (r === ref) css = String(def.css ?? ''); }};
  vm.runInNewContext(source, {MC, window: {MC}}, {timeout: 500});
  return css;
};

/**
 * The style's fonts, declared in static CSS: components set fonts from tokens at run time, which the compiler can't
 * see. A hidden element per family and weight makes it embed each one.
 */
export const tokenFonts = (types: Record<string, {font: string; weight: number; italic?: boolean}>) => {
  const seen = new Map<string, {font: string; weight: number; italic: boolean}>();
  for (const t of Object.values(types)) seen.set(`${t.font}|${t.weight}|${!!t.italic}`, {font: t.font, weight: t.weight, italic: !!t.italic});
  const list = [...seen.values()];
  return {
    css: list.map((f, i) => `.mc-font-${i}{font-family:'${f.font}';font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'}}`).join('\n'),
    html: `<div aria-hidden="true" style="position:absolute;left:-9999px;top:0;opacity:0">${list.map((_, i) => `<span class="mc-font-${i}">Aaʻʼ</span>`).join('')}</div>`,
    families: [...new Set(list.map((f) => f.font))],
  };
};
